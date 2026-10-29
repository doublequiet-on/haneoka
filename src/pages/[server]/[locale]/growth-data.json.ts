import { growthPageData } from "../../../server/growth-page-data";
import { RELEASE_SERVERS } from "../../../lib/release-server";
import { LOCALES } from "../../../i18n/locales";
import { staticBuildPaths } from "../../../server/static-build";
export function getStaticPaths() {
  return staticBuildPaths("src/pages/[server]/[locale]/growth-data.json.ts", RELEASE_SERVERS.flatMap(server => LOCALES.map(locale => ({params: {server, locale}}))));
}
export async function GET({params}: {params: {server: typeof RELEASE_SERVERS[number]; locale: string}}) {
  return new Response(JSON.stringify(await growthPageData(params.server, params.locale)), {headers: {"content-type": "application/json"}});
}
