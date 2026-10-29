# L3 — GEB
# Input: Canonical collector region.
# Output: Fixed API, credential, descriptor and CDN discovery contracts.
# Pos: [Map](../../L2.md); shared region identity for acquisition and storage.
# Effects/Dependencies: Pure region lookup; no network or credential reads.
from dataclasses import dataclass


@dataclass(frozen=True)
class Region:
    credential_region: str
    host: str
    descriptor: str
    area_id: int|None=None
    cdn_prefix: str|None=None
    cdn_hosts: tuple[str,...]=()
    alternate_hosts: tuple[str,...]=()

    @property
    def origin(self):
        return 'https://' + self.host

    @property
    def credential_origins(self):
        return tuple('https://'+host for host in (self.host,*self.alternate_hosts))


REGIONS = {
    'jp': Region('jp', 'api.bang-dream-on.jp', 'total-descriptors.pb'),
    'tw': Region('hk', 'l12-prod-hk-all-gs-sirius.gamerfusiontech.com', 'intl-descriptors.pb',2,'hk',
                 ('l14-prod-hk-patch-sirius.gamerfusiontech.com','l12-prod-hk-patch-sirius.gamerfusiontech.com'),
                 ('l14-prod-hk-all-gs-sirius.gamerfusiontech.com',)),
    'en': Region('en', 'l14-prod-va-all-gs-sirius.bilibiligame.net', 'intl-descriptors.pb',3,'en',
                 ('l14-prod-sg-patch-sirius.bilibiligame.net','l12-prod-sg-patch-sirius.bilibiligame.net'),
                 ('l17-prod-va-all-gs-sirius.bilibiligame.net',)),
    'kr': Region('kr', 'l14-prod-kr-all-gs-sirius.bilibiligame.net', 'intl-descriptors.pb',4,'kr',
                 ('l14-prod-sg-patch-sirius.bilibiligame.net','l12-prod-sg-patch-sirius.bilibiligame.net'),
                 ('l17-prod-kr-all-gs-sirius.bilibiligame.net',)),
}


def region_config(region):
    try:
        return REGIONS[region]
    except (KeyError, TypeError):
        raise ValueError('Unsupported ranking region') from None


def select_api_origin(region,value=None):
    configured=region_config(region)
    origin=configured.origin if value is None else value
    if origin not in configured.credential_origins:raise ValueError('API origin does not match ranking region')
    return origin
