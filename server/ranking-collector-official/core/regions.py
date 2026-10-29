"""L3: server/L2.md; official region identities shared by acquisition and storage."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Region:
    credential_region: str
    host: str
    descriptor: str

    @property
    def origin(self):
        return 'https://' + self.host


REGIONS = {
    'jp': Region('jp', 'api.bang-dream-on.jp', 'total-descriptors.pb'),
    'tw': Region('hk', 'l12-prod-hk-all-gs-sirius.gamerfusiontech.com', 'intl-descriptors.pb'),
    'en': Region('en', 'l14-prod-va-all-gs-sirius.bilibiligame.net', 'intl-descriptors.pb'),
    'kr': Region('kr', 'l14-prod-kr-all-gs-sirius.bilibiligame.net', 'intl-descriptors.pb'),
}


def region_config(region):
    try:
        return REGIONS[region]
    except (KeyError, TypeError):
        raise ValueError('Unsupported ranking region') from None
