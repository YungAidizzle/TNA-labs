from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


TOKEN_PATTERN = re.compile(r"[a-z0-9$#][a-z0-9$#'_-]{1,63}", re.IGNORECASE)
WHITESPACE_PATTERN = re.compile(r"\s+")
CONNECTOR_SPLIT_PATTERN = re.compile(
    r"\b(?:driving|fueling|fuelling|triggering|sparking|reviving|sending|keeping|pushing|after|amid|while|with|into)\b",
    re.IGNORECASE,
)

GENERIC_FOCUS_TOKENS = {
    "attention",
    "board",
    "community",
    "communities",
    "content",
    "creator",
    "debate",
    "debates",
    "discussion",
    "discourse",
    "internet",
    "meme",
    "memes",
    "news",
    "online",
    "platform",
    "post",
    "posts",
    "reaction",
    "reactions",
    "speculation",
    "story",
    "trend",
    "trends",
    "update",
    "updates",
    "viral",
}

MEMECOIN_PREFERRED_TERMS: dict[str, set[str]] = {
    "animal_meme": {
        "animal",
        "cat",
        "cats",
        "dog",
        "dogs",
        "doge",
        "frog",
        "frogs",
        "hippo",
        "penguin",
        "mascot",
        "character",
        "creature",
        "pom",
        "pomeranian",
        "shiba",
        "pepe",
        "mog",
        "wojak",
    },
    "catchphrase_wave": {
        "catchphrase",
        "slogan",
        "nickname",
        "tagline",
        "quote",
        "one-liner",
        "copypasta",
        "chant",
        "soundbite",
    },
    "creator_viral_moment": {
        "creator",
        "creators",
        "influencer",
        "influencers",
        "streamer",
        "streamers",
        "youtuber",
        "tiktoker",
        "vtuber",
        "fanbase",
        "podcast",
        "livestream",
        "channel",
        "clip farm",
    },
    "celebrity_meme": {
        "celebrity",
        "actor",
        "actress",
        "musician",
        "rapper",
        "singer",
        "athlete",
        "superstar",
        "swiftie",
        "stan",
    },
    "platform_drama": {
        "twitter",
        "x.com",
        "reddit",
        "subreddit",
        "tiktok",
        "youtube",
        "telegram",
        "discord",
        "twitch",
        "verification",
        "algorithm",
        "moderation",
        "outage",
        "platform backlash",
        "platform debate",
    },
    "ai_meme_wave": {
        "ai companion",
        "ai girlfriend",
        "ai boyfriend",
        "deepfake",
        "parody edit",
        "image model",
        "video model",
        "ai agent",
        "agents",
        "grok",
        "chatgpt",
        "claude",
        "gemini",
        "avatar",
        "companion",
    },
    "fandom_wave": {
        "anime",
        "manga",
        "fan edit",
        "fan edits",
        "fancam",
        "fan art",
        "fandom",
        "shipping",
        "stan war",
        "k-pop",
        "cosplay",
        "pokemon",
        "nintendo",
        "roblox",
        "fortnite",
    },
    "gaming_meme": {
        "gaming",
        "game",
        "gamer",
        "steam",
        "patch notes",
        "speedrun",
        "boss fight",
        "lootbox",
        "nerf",
        "buff",
    },
    "crypto_spillover": {
        "memecoin",
        "memecoins",
        "meme coin",
        "solana meme",
        "base meme",
        "launchpad",
        "pump.fun",
        "letsbonk",
        "cto",
        "community takeover",
        "etf inflows",
        "spot bitcoin etf",
        "token launch",
        "listing",
        "retail speculation",
        "onchain speculation",
        "rotation",
    },
    "meme_distribution": {
        "viral",
        "meme",
        "memes",
        "remix",
        "remixes",
        "parody",
        "parodies",
        "edit",
        "edits",
        "clip",
        "clips",
        "shitpost",
        "shitposts",
        "reaction image",
        "reaction images",
        "reposts",
        "timeline",
        "brainrot",
        "quote tweet",
    },
    "tokenizable_object": {
        "mascot",
        "character",
        "companion",
        "avatar",
        "nickname",
        "catchphrase",
        "slogan",
        "clip",
        "deepfake",
        "parody",
        "frog",
        "dog",
        "cat",
        "hippo",
    },
    "memeified_politics": {
        "mugshot",
        "debate clip",
        "rally clip",
        "slogan meme",
        "campaign meme",
        "parody ad",
        "quote tweet war",
    },
}

MEMECOIN_DEPRIORITIZED_TERMS: dict[str, set[str]] = {
    "geopolitics_macro": {
        "ceasefire",
        "tariff",
        "tariffs",
        "inflation",
        "interest rates",
        "rate cut",
        "rate hike",
        "federal reserve",
        "senate",
        "parliament",
        "sanction",
        "sanctions",
        "missile",
        "missiles",
        "war",
        "wars",
    },
    "dry_business": {
        "enterprise",
        "enterprises",
        "earnings",
        "board meeting",
        "procurement",
        "partnership framework",
        "pricing update",
        "api pricing",
        "internal rollout",
        "b2b",
        "quarterly",
    },
    "dry_crypto": {
        "committee hearing",
        "compliance",
        "governance",
        "validator update",
        "consensus upgrade",
        "infrastructure release",
        "audit",
        "framework",
        "interoperability",
    },
    "hard_news": {
        "attack",
        "attacks",
        "earthquake",
        "wildfire",
        "evacuation",
        "fatalities",
        "police",
        "court filing",
        "indictment",
    },
    "generic_noise": {
        "internet debate",
        "creator drama",
        "celebrity drama",
        "platform update",
        "policy development",
        "market update",
        "trend update",
        "news update",
    },
}

CATEGORY_BUCKET_MAP = {
    "ai tech": "ai_tech",
    "animal meme": "meme",
    "catchphrase wave": "meme",
    "creator viral moment": "creator",
    "creator": "creator",
    "culture": "internet_culture",
    "celebrity meme": "entertainment",
    "entertainment": "entertainment",
    "platform drama": "internet_culture",
    "ai meme wave": "ai_tech",
    "fandom wave": "entertainment",
    "gaming": "gaming",
    "gaming meme": "gaming",
    "meme": "meme",
    "crypto spillover": "crypto_spillover",
    "crypto": "crypto_spillover",
    "memeified politics": "memeified_politics",
    "internet culture": "internet_culture",
}


@dataclass(frozen=True)
class MemecoinAttentionProfile:
    preferred_hits: dict[str, int]
    deprioritized_hits: dict[str, int]
    score: float
    inferred_category: str | None
    bucket: str | None
    tokenizable_narrative: bool
    memeified_politics: bool


def _normalize_text(value: Any) -> str:
    return WHITESPACE_PATTERN.sub(" ", str(value or "").strip()).strip()


def _normalize_lower(value: Any) -> str:
    return _normalize_text(value).lower()


def _tokenize(value: Any) -> list[str]:
    return [token.lower() for token in TOKEN_PATTERN.findall(_normalize_text(value))]


def _count_phrase_matches(text: str, phrases: set[str]) -> int:
    normalized = _normalize_lower(text)
    if not normalized:
        return 0
    count = 0
    text_tokens = set(_tokenize(normalized))
    for phrase in phrases:
        candidate = _normalize_lower(phrase)
        if not candidate:
            continue
        tokens = _tokenize(candidate)
        if len(tokens) == 1 and tokens[0] == candidate:
            if candidate in text_tokens:
                count += 1
            continue
        if candidate in normalized:
            count += 1
    return count


def _trim_focus_tokens(tokens: list[str]) -> list[str]:
    start = 0
    end = len(tokens)
    while start < end and tokens[start].lower() in GENERIC_FOCUS_TOKENS:
        start += 1
    while end > start and tokens[end - 1].lower() in GENERIC_FOCUS_TOKENS:
        end -= 1
    return tokens[start:end]


def _focus_phrases_from_text(text: Any, *, max_phrases: int) -> list[str]:
    normalized = _normalize_text(text)
    if not normalized:
        return []
    phrases: list[str] = []
    for segment in CONNECTOR_SPLIT_PATTERN.split(normalized):
        raw_tokens = re.findall(r"[A-Za-z0-9$#][A-Za-z0-9$#'_-]{0,31}", segment)
        tokens = _trim_focus_tokens(raw_tokens)
        if len(tokens) < 2:
            continue
        phrases.append(" ".join(tokens[:5]))
        if len(phrases) >= max_phrases:
            break
    return phrases


def _usable_focus_phrase(value: str) -> bool:
    normalized = _normalize_text(value)
    if not normalized:
        return False
    lowered_tokens = [token.lower() for token in re.findall(r"[A-Za-z0-9$#][A-Za-z0-9$#'_-]{0,31}", normalized)]
    if len(lowered_tokens) < 2:
        return False
    informative_tokens = [token for token in lowered_tokens if token not in GENERIC_FOCUS_TOKENS]
    return len(informative_tokens) >= 2


def extract_memecoin_seed_phrases(
    label: Any,
    *,
    narrative_summary: Any = None,
    key_entities: list[str] | None = None,
    max_phrases: int = 4,
) -> list[str]:
    phrases: list[str] = []
    for entity in key_entities or []:
        normalized_entity = _normalize_text(entity)
        if _usable_focus_phrase(normalized_entity):
            phrases.append(normalized_entity)
        if len(phrases) >= max_phrases:
            break
    if len(phrases) < max_phrases:
        phrases.extend(_focus_phrases_from_text(label, max_phrases=max_phrases - len(phrases)))
    if len(phrases) < max_phrases:
        phrases.extend(_focus_phrases_from_text(narrative_summary, max_phrases=max_phrases - len(phrases)))
    seen: set[str] = set()
    output: list[str] = []
    for phrase in phrases:
        normalized = _normalize_text(phrase)
        if not _usable_focus_phrase(normalized):
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(normalized)
        if len(output) >= max_phrases:
            break
    return output


def profile_memecoin_attention(
    *texts: Any,
    raw_category: Any = None,
) -> MemecoinAttentionProfile:
    normalized_text = " ".join(_normalize_text(value) for value in texts if _normalize_text(value)).strip()
    category_text = _normalize_lower(raw_category).replace("_", " ")
    preferred_hits = {
        bucket: _count_phrase_matches(normalized_text, phrases)
        for bucket, phrases in MEMECOIN_PREFERRED_TERMS.items()
    }
    deprioritized_hits = {
        bucket: _count_phrase_matches(normalized_text, phrases)
        for bucket, phrases in MEMECOIN_DEPRIORITIZED_TERMS.items()
    }

    tokenizable_narrative = any(
        preferred_hits.get(bucket, 0) > 0
        for bucket in (
            "animal_meme",
            "catchphrase_wave",
            "creator_viral_moment",
            "ai_meme_wave",
            "fandom_wave",
            "gaming_meme",
            "crypto_spillover",
            "tokenizable_object",
        )
    )
    memeified_politics = preferred_hits.get("memeified_politics", 0) > 0 or (
        deprioritized_hits.get("geopolitics_macro", 0) > 0 and preferred_hits.get("meme_distribution", 0) > 0
    )

    score = 0.0
    score += preferred_hits.get("animal_meme", 0) * 8.0
    score += preferred_hits.get("catchphrase_wave", 0) * 7.0
    score += preferred_hits.get("creator_viral_moment", 0) * 6.0
    score += preferred_hits.get("celebrity_meme", 0) * 5.0
    score += preferred_hits.get("platform_drama", 0) * 6.0
    score += preferred_hits.get("ai_meme_wave", 0) * 7.0
    score += preferred_hits.get("fandom_wave", 0) * 6.0
    score += preferred_hits.get("gaming_meme", 0) * 6.0
    score += preferred_hits.get("crypto_spillover", 0) * 7.0
    score += preferred_hits.get("meme_distribution", 0) * 6.0
    score += preferred_hits.get("tokenizable_object", 0) * 6.0
    if tokenizable_narrative:
        score += 10.0
    else:
        score -= 12.0
    if preferred_hits.get("meme_distribution", 0) <= 0 and preferred_hits.get("crypto_spillover", 0) <= 0:
        score -= 8.0
    if deprioritized_hits.get("geopolitics_macro", 0) > 0 and not memeified_politics:
        score -= 18.0
    score -= deprioritized_hits.get("dry_business", 0) * 10.0
    score -= deprioritized_hits.get("dry_crypto", 0) * 8.0
    score -= deprioritized_hits.get("hard_news", 0) * 12.0
    score -= deprioritized_hits.get("generic_noise", 0) * 8.0

    ordered_buckets = sorted(
        preferred_hits.items(),
        key=lambda item: (item[1], item[0]),
        reverse=True,
    )
    inferred_category = ordered_buckets[0][0].replace("_", " ") if ordered_buckets and ordered_buckets[0][1] > 0 else None
    if category_text in CATEGORY_BUCKET_MAP:
        inferred_category = category_text
    bucket = CATEGORY_BUCKET_MAP.get(inferred_category) if inferred_category else None

    return MemecoinAttentionProfile(
        preferred_hits=preferred_hits,
        deprioritized_hits=deprioritized_hits,
        score=score,
        inferred_category=inferred_category,
        bucket=bucket,
        tokenizable_narrative=tokenizable_narrative,
        memeified_politics=memeified_politics,
    )


def infer_memecoin_trend_category(
    *texts: Any,
    raw_category: Any = None,
) -> str | None:
    profile = profile_memecoin_attention(*texts, raw_category=raw_category)
    return profile.inferred_category
