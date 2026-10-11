import re
import PTN
import unicodedata

from typing import List, Optional , Union
from dataclasses import dataclass, field

@dataclass
class Movie:
    title: str
    context_type: str
    normalized_title: str
    year: Optional[int]
    resolution: Optional[str]
    quality: Optional[str]
    codec: Optional[str]
    extra: List[str] = field(default_factory=list)
    split: bool = False
    part: Optional[int] = None

@dataclass
class TV:
    title: str
    context_type: str
    normalized_title: str
    season: Optional[int]
    episode: Optional[int]
    resolution: Optional[str]
    quality: Optional[str]
    codec: Optional[str]
    extra: List[str] = field(default_factory=list)
    split: bool = False
    part: Optional[int] = None

class MovieParser:
    def __parse_file_name(self, file_name: str):
        file_name = re.sub(r'@[\w_]+', '', file_name.lower()).strip()
        file_name = file_name.replace('_', ' ')
        self.file_name = file_name
        self.extension = self.file_name.split('.')[-1]
        self.data = PTN.parse(self.file_name)
        self.tv, self.movie = (self.data, None) if "season" in self.data else (None, self.data)
        self.tags = []

    def fallback_title(self, file_name):
        name = re.sub(r'\.\w{2,4}$', '', file_name)
        name = name.replace('_', ' ').replace('.', ' ')
        name = re.sub(r'@\w+', '', name)
        name = unicodedata.normalize('NFKC', name)
        tags_pattern = r'\b(480p|720p|1080p|2160p|BR_Rip|WEBRip|HDRip|x264|x265|HEVC|AAC|DD\+?5\.1|[0-9]+MB|1GB|2GB|Tamil|Telugu|Hindi|English|Dubbed|HDTV|WEB-DL|BluRay|Blu-ray|YTS|YIFY|fps)\b'
        name = re.sub(tags_pattern, '', name, flags=re.IGNORECASE)
        name = re.split(r'\b(S\d+|Ep\d+)\b', name, 1)[0]
        name = re.sub(r'\s+', ' ', name).strip()
        return name

    def fallback_year(self, file_name):
        years = re.findall(r'(?<!\d)(19\d{2}|20\d{2})(?!\d)', file_name)
        return int(years[0]) if years else None

    def _fix_roman_numerals(self, text: str) -> str:
        roman_pattern = r'\b(i{1,3}|iv|v|vi{0,3}|ix|x{1,3}|xl|l|li{0,3}|lx|xc|c|ci{0,3}|cd|d|dc|cm|m|m{1,3})\b'
        return re.sub(roman_pattern, lambda m: m.group(0).upper(), text, flags=re.IGNORECASE)


    def _handle_movie(self):
        pass

    def extract(self, file_name: str) -> Union[Movie, TV]:
        self.__parse_file_name(file_name)
        
        title = str(self.data.get('title', '')).replace('.', ' ').strip()
        if not title:title = self.fallback_title(self.file_name)
        else:title = title.replace('.', ' ').strip()

        year = self.data.get('year',None) or self.fallback_year(self.file_name)
        if year and str(year) in title:title = title.replace(str(year), '').strip()

        resolution = self.data.get('resolution')
        quality = self.data.get('quality')
        codec = self.data.get('codec')
        if codec:codec = codec.replace('H', 'x').replace('.', '')

        extra = []
        tag_keywords = {
            'psa': 'PSA',
            'pahe': 'Pahe',
            'galaxyrg': 'GalaxyRG',
            'yify': 'YIFY',
            'yts': 'YTS',
            'rarbg': 'RARBG',
            'ettv': 'ETTV',
            'evo': 'EVO',
            'fgt': 'FGT',
            'ntg': 'NTG',
            'tigole': 'Tigole',
            'qxr': 'QxR',
            'vxt': 'VXT',
            'cm8': 'CM8',
            'naisu': 'NAISU',
            'kog': 'KOGi',
            'spark': 'SPARKS',
            'don': 'DON',
            'lama': 'LAMA',
            'drone': 'DRONES',
            'iht': 'IHT',
            'amzn-rls': 'Amazon Release',

            'nf': 'Netflix',
            'amzn': 'Amazon',
            'hmax': 'HBO Max',
            'dsnp': 'Disney+',
            'hulu': 'Hulu',
            'appletv': 'Apple TV+',
            'paramount': 'Paramount+',
            'peacock': 'Peacock',
            'crave': 'Crave',
            'zee5': 'ZEE5',
            'sony': 'SonyLiv',
            'atvp': 'Apple TV+',
            'mbc': 'MBC',

            'imax': 'IMAX',
            'hdr': 'HDR',
            'hdr10': 'HDR10',
            'hdr10+': 'HDR10+',
            'dolbyvision': 'Dolby Vision',
            'dv': 'Dolby Vision',
            'visionplus': 'Dolby Vision+',
            '60fps': '60FPS',
            '50fps': '50FPS',
            '10bit': '10bit',
            '8bit': '8bit',
            'hevc': 'HEVC',
            'av1': 'AV1',

            'aac': 'AAC',
            'aac2': 'AAC2.0',
            'aac5': 'AAC5.1',
            'ac3': 'AC3',
            'eac3': 'EAC3',
            'dd': 'Dolby Digital',
            'ddp': 'Dolby Digital Plus',
            'ddp5': 'DDP5.1',
            'truehd': 'TrueHD',
            'dts': 'DTS',
            'dtsma': 'DTS-HD MA',
            'dtsx': 'DTS:X',
            'atmos': 'Dolby Atmos',
            'flac': 'FLAC',
            'opus': 'Opus',
            'mp3': 'MP3',
            'lpcm': 'LPCM',

            'remux': 'Remux',
            'repack': 'Repack',
            'rerip': 'ReRip',
            'proper': 'Proper',
            'uncut': 'Uncut',
            'extended': 'Extended',
            'directors': "Director's Cut",
            'criterion': 'Criterion',
            'uncensored': 'Uncensored',
            'festival': 'Festival Cut',
            'sample': 'Sample',

            '1337x': '1337x',
            'eztv': 'EZTV',
            'torrentgalaxy': 'TorrentGalaxy',
            'scene': 'Scene Release',
            'internal': 'Internal',
            'limited': 'Limited',
            'complete': 'Complete Series',
            'part': 'Part',
            'dubbed': 'Dubbed',
            'subbed': 'Subbed',
            'multi': 'Multi Audio',
            'dual': 'Dual Audio',
            'retail': 'Retail Rip',
}

        for k, v in tag_keywords.items():
            if k in self.file_name:
                extra.append(v)

        if any(k in self.file_name for k in ['dolby', 'atmos']):
            extra.append('DolbyAtmos')

        match = re.search(r'\.(\d{3})$', file_name)
        split = match is not None
        part = int(match.group(1)) if split else None
        if self.movie:
            return Movie(
                title=self._fix_roman_numerals(text=title.title()),
                context_type="movie",
                normalized_title=re.sub(r'[^a-z0-9&\+]+', ' ', title.lower()).strip(),
                year=year,
                resolution=resolution,
                quality=quality,
                codec=codec,
                extra=extra,
                split=split,
                part=part
            )
        else:
            return TV(
                title=self._fix_roman_numerals(text=title.title()),
                context_type="tv",
                normalized_title=re.sub(r'[^a-z0-9&\+]+', ' ', title.lower()).strip(),
                season=self.data.get('season'),
                episode=self.data.get('episode'),
                resolution=resolution,
                quality=quality,
                codec=codec,
                extra=extra,
                split=split,
                part=part
            )

parser = MovieParser()