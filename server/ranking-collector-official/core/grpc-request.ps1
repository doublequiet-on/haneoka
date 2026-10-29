# L3: server/L2.md -> ranking-collector-official; fixed JP read-only transport.
param(
  [Parameter(Mandatory)][string]$RequestFile,
  [Parameter(Mandatory)][string]$ResponseFile
)
$ErrorActionPreference='Stop'
$taskSpec=Get-Content -LiteralPath $RequestFile -Raw | ConvertFrom-Json
$taskAllowed=@('/app.masterdata.MasterdataService/Version','/app.event.EventService/GetChallengeMusicRanking','/app.event.EventService/GetChallengeMusicTotalRanking')
if($taskSpec.path -notin $taskAllowed){throw 'Unsupported read operation'}
if($taskSpec.client_version -notmatch '^\d+\.\d+\.\d+$'){throw 'Invalid client version'}
$taskAnonymous=$taskSpec.path -eq $taskAllowed[0]
$taskHandler=[System.Net.Http.SocketsHttpHandler]::new()
$taskHandler.AllowAutoRedirect=$false
$taskHandler.ConnectTimeout=[TimeSpan]::FromSeconds(8)
$taskHandler.UseProxy=[bool]$taskSpec.proxy
if($taskSpec.proxy){
  if($taskSpec.proxy -ne 'http://127.0.0.1:7890'){throw 'Only the existing local proxy is allowed'}
  $taskHandler.Proxy=[System.Net.WebProxy]::new([string]$taskSpec.proxy)
}
if($taskSpec.connect_ip){
  if($taskSpec.proxy){throw 'Choose either proxy or direct IP transport'}
  Add-Type -TypeDefinition @'
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
public static class DirectConnection {
  public static void Configure(SocketsHttpHandler handler, string address) {
    var ip = IPAddress.Parse(address);
    handler.ConnectCallback = async (context, cancellation) => {
      var socket = new Socket(SocketType.Stream, ProtocolType.Tcp);
      try {
        await socket.ConnectAsync(ip, context.DnsEndPoint.Port, cancellation);
        return new NetworkStream(socket, true);
      } catch { socket.Dispose(); throw; }
    };
  }
}
'@
  [DirectConnection]::Configure($taskHandler,[string]$taskSpec.connect_ip)
}
$taskClient=[System.Net.Http.HttpClient]::new($taskHandler)
$taskClient.Timeout=[TimeSpan]::FromSeconds(20)
$taskClient.MaxResponseContentBufferSize=16777216
$taskRequest=[System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post,('https://api.bang-dream-on.jp'+$taskSpec.path))
$taskRequest.Version=[Version]::new(2,0)
$taskRequest.VersionPolicy=[System.Net.Http.HttpVersionPolicy]::RequestVersionExact
$taskBody=[Convert]::FromBase64String($taskSpec.body_base64)
if($taskBody.Length -gt 4096){throw 'Request too large'}
$taskRequest.Content=[System.Net.Http.ByteArrayContent]::new($taskBody)
$taskRequest.Content.Headers.ContentType=[System.Net.Http.Headers.MediaTypeHeaderValue]::new('application/grpc')
$taskHeaders=@{'te'='trailers';'x-client-version'=[string]$taskSpec.client_version;'x-platform'='android';'x-request-id'=[Guid]::NewGuid().ToString()}
if(-not $taskAnonymous){
  if(-not $taskSpec.credential_file){throw 'Missing credential file'}
  $taskAuth=Get-Content -LiteralPath $taskSpec.credential_file -Raw | ConvertFrom-Json
  if($taskAuth.region -ne 'jp' -or $taskAuth.origin -ne 'https://api.bang-dream-on.jp'){throw 'Credential origin mismatch'}
  if(-not $taskAuth.credentials.player_id -or -not $taskAuth.credentials.credential){throw 'Incomplete game identity'}
  $taskHasher=[System.Security.Cryptography.SHA256]::Create()
  try { $taskIdentity=[BitConverter]::ToString($taskHasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes([string]$taskAuth.credentials.player_id))).Replace('-','').ToLowerInvariant() }
  finally { $taskHasher.Dispose() }
  if($taskSpec.credential_identity -cnotmatch '^[a-f0-9]{64}$' -or $taskIdentity -cne $taskSpec.credential_identity){throw 'Credential account changed'}
  $taskHeaders['x-player-id']=[string]$taskAuth.credentials.player_id
  $taskHeaders['x-player-credential']=[string]$taskAuth.credentials.credential
  if($taskAuth.credentials.device_id){$taskHeaders['x-device-id']=[string]$taskAuth.credentials.device_id}
  if(-not $taskSpec.master_version){throw 'Missing verified master version'}
  $taskHeaders['x-master-version']=[string]$taskSpec.master_version
}
foreach($taskHeader in $taskHeaders.GetEnumerator()){$null=$taskRequest.Headers.TryAddWithoutValidation($taskHeader.Key,$taskHeader.Value)}
$taskOut=[ordered]@{started_at=[DateTime]::UtcNow.ToString('o');origin='https://api.bang-dream-on.jp';path=$taskSpec.path;client_version=$taskSpec.client_version;authenticated=(-not $taskAnonymous);transport='SocketsHttpHandler';runtime=[System.Runtime.InteropServices.RuntimeInformation]::FrameworkDescription;headers=@{};trailers=@{}}
$taskClock=[System.Diagnostics.Stopwatch]::StartNew()
$taskOut.connect_ip=$taskSpec.connect_ip
$taskOut.proxy=$taskSpec.proxy
try {
  $taskResponse=$taskClient.SendAsync($taskRequest).GetAwaiter().GetResult()
  $taskResponseBody=$taskResponse.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
  $taskOut.status=[int]$taskResponse.StatusCode
  $taskOut.http_version=$taskResponse.Version.ToString()
  $taskOut.bytes=$taskResponseBody.Length
  foreach($taskHeader in $taskResponse.Headers){if($taskHeader.Key.ToLowerInvariant() -in @('server','date','grpc-status','grpc-message','x-asset-version','x-error-code','retry-after')){$taskOut.headers[$taskHeader.Key]=($taskHeader.Value -join ',')}}
  foreach($taskHeader in $taskResponse.TrailingHeaders){if($taskHeader.Key.ToLowerInvariant() -in @('grpc-status','grpc-message','x-error-code')){$taskOut.trailers[$taskHeader.Key]=($taskHeader.Value -join ',')}}
  $taskOut.body_base64=[Convert]::ToBase64String($taskResponseBody)
  $taskCdn=$null
  if($taskAnonymous -and $taskSpec.include_cdn -and $taskResponse.IsSuccessStatusCode){
    $taskCdn=@{}
    foreach($taskHeader in $taskResponse.Headers){
      if($taskHeader.Key.ToLowerInvariant() -in @('x-sirius-env','x-sirius-cred')){
        $taskCdn[$taskHeader.Key.ToLowerInvariant()]=($taskHeader.Value -join ',')
      }
    }
  }
  $taskResponse.Dispose()
} catch {
  $taskOut.error_type=$_.Exception.GetType().FullName
  $taskOut.error_message=$_.Exception.Message
} finally {
  $taskClock.Stop()
  $taskOut.elapsed_ms=$taskClock.ElapsedMilliseconds
  $taskOut.received_at=[DateTime]::UtcNow.ToString('o')
  $taskRequest.Dispose(); $taskClient.Dispose()
}
$taskOut | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $ResponseFile -Encoding utf8
[pscustomobject]@{status=$taskOut.status;bytes=$taskOut.bytes;grpc_status=$taskOut.trailers['grpc-status'];elapsed_ms=$taskOut.elapsed_ms;error=$taskOut.error_type;cdn=$taskCdn} | ConvertTo-Json -Compress
