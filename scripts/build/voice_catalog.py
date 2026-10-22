# L3 — GEB
# Input: Master voice records, projected short stories and exact CRI outputs.
# Output: Character voice entries with game collection groups and complete short-form audio.
# Pos: [Map](L2-2.md); character voice collection projection.
# Effects/Dependencies: Reads the build data interface; preserves story and CRI provenance.
"""Project the game's voice collection and supplementary character audio."""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any


COLLECTION_GROUPS = (
    "normal", "realLive", "feature", "seasonal", "birthday", "growth", "gacha",
    "liveStart", "gekisouStart", "gekisouEnd", "liveEnd", "liveDialogue",
    "livePairDialogue", "liveResult", "liveBattleResult", "location", "title",
    "other",
)
TALK_KINDS = {
    0: ("normal", "normal"), 1: ("feature", "characterRankUp"),
    2: ("seasonal", "seasonal"), 3: ("birthday", "birthday"),
    4: ("feature", "login"), 5: ("feature", "exchange"),
    6: ("realLive", "realLiveDay"), 7: ("feature", "levelUp"),
    8: ("realLive", "realLiveBefore"),
}
CHARACTER_KINDS = (
    ("growth", "levelUp"), ("growth", "awaken"), ("growth", "skillUp"),
    ("growth", "rankUp"), ("liveEnd", "clear"), ("liveEnd", "fullCombo"),
    ("liveEnd", "allPerfect"), ("liveResult", "result"),
    ("liveBattleResult", "battleFirst"), ("liveBattleResult", "battleHigh"),
    ("liveBattleResult", "battleLow"),
)
TITLE_CUE = re.compile(r"^Title_([A-Za-z]+|\d+)_(App_ON|Company_[A-Za-z]+)_(\d+)$", re.I)
SPOT_CUE = re.compile(r"^spot_(\d+)_(\d+)_(\d+)_(.+)_(\d+)_(tap|after)$", re.I)
RESULT_CUE = re.compile(r"^Result_([A-Za-z]+)_Talk_CP_?([A-Za-z]+)_(Call|Res)_(\d+)(?:_(\d+))?$", re.I)


def _classify(entry: dict[str, Any]) -> tuple[str, str]:
    source = entry.get("masterType")
    if source == 0:
        group, kind = TALK_KINDS.get(entry["talkCategory"], ("feature", "feature"))
        if kind == "seasonal":
            kind = {
                ("4/1", "4/30"): "spring", ("7/1", "8/31"): "summer",
                ("9/1", "11/30"): "autumn", ("12/1", "2/28"): "winter",
                ("12/24", "12/26"): "christmas", ("1/1", "1/4"): "newYear",
                ("2/14", "2/15"): "valentine",
            }.get((entry.get("seasonStartAt"), entry.get("seasonEndAt")), kind)
        return group, kind
    if source == 1:
        return dict(enumerate(CHARACTER_KINDS)).get(entry["characterVoiceType"], ("other", "other"))
    if source == 2:
        return "gacha", "gacha"
    if source == 3:
        return "liveDialogue", "skill"
    if source == 4:
        return {
            0: ("gekisouStart", "gekisouCombo"), 1: ("gekisouStart", "gekisouJust"),
            2: ("gekisouStart", "gekisouLuck"), 3: ("gekisouEnd", "gekisouTop"),
        }.get(entry["gekisouVoiceType"], ("other", "other"))
    if source in (5, 6):
        return ("liveDialogue" if source == 5 else "livePairDialogue"), (
            "skill" if entry["dialogueType"] == 2 else "combo"
        )
    if source == 7:
        return "liveStart", "start"
    return "other", "other"


def _output_sound(data, entry: dict, output: dict) -> dict:
    return {
        **output,
        "category": 2, "categoryName": "Voice",
        "cueSheetName": entry["runtimePath"].rsplit("/", 1)[-1],
        "runtimePath": entry["runtimePath"], "outputPath": output["path"],
        "playableUrl": data.runtime_output_url(output["path"]),
        "missing": False, "binding": "exact-cri-output",
    }


def complete_voices(data, entries: dict[str, dict], stories: dict) -> dict[str, dict]:
    for entry in entries.values():
        entry["voiceGroup"], entry["voiceKind"] = _classify(entry)

    spots = {str(row["_id"]): row for row in data.rows("MasterHomeSpot")}
    spot_stories = {}
    adv_ids = {int(row["_id"]): str(row.get("_advEpisodeAsset") or "").removeprefix("adv_script_") for row in data.rows("MasterAdv")}
    for identity, spot in spots.items():
        story_id = adv_ids.get(int(spot.get("_advId") or 0))
        if story_id:
            spot_stories[story_id] = ({"spotId": int(identity)}, "spot")
    for row in data.rows("MasterStoryHomeSpotTapTalkEpisode"):
        story_id = adv_ids.get(int(row.get("_advId") or 0))
        if story_id:
            spot_stories[story_id] = ({"spotId": int(row["_spotId"])}, "tap")
    for spot in stories.get("homeSpots", {}).values():
        for talk in spot.get("talks", []):
            spot_stories[talk["storyKey"]] = (spot, talk["type"])
    represented: set[tuple[str, str]] = set()
    for story_id, story in stories.get("episodes", {}).items():
        chapter = story.get("chapterId")
        if chapter not in (900000, 900001):
            continue
        sounds = {sound["resourceRef"]: sound for sound in story.get("assets", {}).get("sounds", [])}
        lines = []
        for command in story.get("commands", []):
            refs = command.get("voiceRefs", [])
            speakers = [int(target.get("characterId") or 0) for target in command.get("targets", [])]
            for index, ref in enumerate(refs):
                sound = sounds.get(ref)
                if not sound or sound.get("category") != 2:
                    continue
                speaker = speakers[index] if len(speakers) == len(refs) else speakers[0] if len(speakers) == 1 else 0
                if not speaker:
                    continue
                lines.append({"characterId": speaker, "text": command.get("text"), "sound": sound})
                represented.add((sound.get("cueSheetName", "").casefold(), sound.get("cueName", "").casefold()))
        if not lines:
            continue
        character_ids = list(dict.fromkeys(line["characterId"] for line in lines))
        spot, talk_type = spot_stories.get(story_id, ({}, ""))
        kind = ("resultPair" if len(character_ids) > 1 else "resultSolo") if chapter == 900000 else (
            "spotTap" if talk_type == "tap" else "spotConversation"
        )
        key = f"story:{story_id}"
        entries[key] = {
            "voiceKey": key, "voiceGroup": "liveResult" if chapter == 900000 else "location",
            "voiceKind": kind, "sourceTable": "MasterStoryLiveResultEpisode" if chapter == 900000 else "MasterHomeSpot",
            "storyId": story_id, "masterId": story.get("episodeNumber", 0),
            "title": story.get("title"), "characterIds": character_ids, "lines": lines,
            "unlockFriendshipRank": story.get("unlockCharacterFriendshipLevel", 0),
            "spotId": spot.get("spotId"), "sourcePath": story.get("scriptAsset"),
        }

    character_keys = {
        str(row.get("_nameTextID", "")).removeprefix("Character_Name_").casefold(): int(row["_id"])
        for row in data.rows("MasterCharacter")
    }
    spot_sounds = {
        int(row.get("_introSoundId") or 0): row for row in spots.values()
    }
    spots_by_sheet = {
        str(data.sound_sheets.get(int(data.sounds.get(sound_id, {}).get("_soundCueSheetID") or 0), {}).get("_cueSheetName") or "").casefold(): spot
        for sound_id, spot in spot_sounds.items()
    }
    direct_cues: dict[tuple[str, str], list[tuple[dict, dict]]] = defaultdict(list)
    declared_cues = {
        (str(data.sound_sheets.get(int(row.get("_soundCueSheetID") or 0), {}).get("_cueSheetName") or "").casefold(), str(row.get("_cueName") or "").casefold())
        for row in data.sounds.values()
    }
    for cri in data.cri_entries:
        for output in cri.get("outputs", []):
            cue = str(output.get("cueName") or "")
            runtime = cri.get("runtimePath", "")
            if cri.get("kind") == "acb" and output.get("path", "").endswith(".mp3"):
                for name in dict.fromkeys(value.strip().casefold() for value in cue.split(";") if value.strip()):
                    direct_cues[(runtime.rsplit("/", 1)[-1].casefold(), name)].append((cri, output))
            result = RESULT_CUE.fullmatch(cue)
            sheet = runtime.rsplit("/", 1)[-1].casefold()
            for name in (value.strip() for value in cue.split(";")):
                spot_cue = SPOT_CUE.fullmatch(name)
                if not spot_cue or (sheet, name.casefold()) in represented or (sheet, name.casefold()) in declared_cues:
                    continue
                speaker = character_keys.get(spot_cue[4].casefold())
                if speaker:
                    spot = spots_by_sheet.get(sheet, {})
                    key = f"location-audio:{runtime.replace('/', '-')}:{output.get('streamIndex', 0)}"
                    entries[key] = {
                        "voiceKey": key, "voiceGroup": "location", "voiceKind": "spotAfter" if spot_cue[6].casefold() == "after" else "spotTap",
                        "characterIds": [speaker], "spotId": int(spot.get("_id") or 0), "masterId": int(spot_cue[5]),
                        "title": data.text(spot.get("_nameTextId")) if spot else None,
                        "sound": _output_sound(data, cri, output), "sourceTable": "CriAudioOutput", "source": cri.get("source"),
                    }
            if result and (sheet, cue.casefold()) not in represented:
                speaker = character_keys.get(result[1].casefold())
                partner = character_keys.get(result[2].casefold())
                if speaker and partner:
                    key = f"result-audio:{runtime.replace('/', '-')}:{output.get('streamIndex', 0)}"
                    entries[key] = {
                        "voiceKey": key, "voiceGroup": "liveResult", "voiceKind": "resultPair",
                        "characterIds": [speaker, partner], "characterId": speaker,
                        "dialogueCallType": 1 if result[3].casefold() == "call" else 2,
                        "masterId": int(result[4]), "variantNumber": int(result[5]) if result[5] else 1,
                        "sound": _output_sound(data, cri, output), "sourceTable": "CriAudioOutput", "source": cri.get("source"),
                    }
            title = TITLE_CUE.fullmatch(cue)
            character_id = (int(title[1]) if title[1].isdigit() else character_keys.get(title[1].casefold())) if title else None
            if title and character_id in character_keys.values():
                brand = "titleBushiroadGames" if runtime.rsplit("/", 1)[-1].casefold() == "initialvoice_bilibili" else "titleBushimo"
                kind = {"app_on": "titleApp", "company_br": brand, "company_ft": "titleFromTokyo", "company_bili": "titleBilibili"}.get(title[2].casefold(), "titleOtherCompany")
                key = f"title:{character_id}:{kind}:{int(title[3])}"
                if key in entries:
                    entries[key].setdefault("sourceAlternates", []).append({"source": cri.get("source"), "runtimePath": runtime, "outputPath": output["path"], "sha256": output["sha256"]})
                    continue
                entries[key] = {
                    "voiceKey": key, "voiceGroup": "title",
                    "voiceKind": kind,
                    "characterIds": [character_id], "masterId": int(title[3]),
                    "sound": _output_sound(data, cri, output), "sourceTable": "CriAudioOutput",
                    "source": cri.get("source"),
                }

    for sound_id, row in sorted(data.sounds.items()):
        cue = str(row.get("_cueName") or "")
        sheet = str(data.sound_sheets.get(int(row.get("_soundCueSheetID") or 0), {}).get("_cueSheetName") or "")
        if (sheet.casefold(), cue.casefold()) in represented:
            continue
        match = SPOT_CUE.fullmatch(cue)
        intro = spot_sounds.get(sound_id)
        if match:
            speaker = character_keys.get(match[4].casefold())
            if not speaker:
                continue
            character_ids = [speaker]
            kind = "spotAfter" if match[6] == "after" else "spotTap"
            spot = spots_by_sheet.get(sheet.casefold(), {})
            spot_id = int(spot.get("_id") or 0)
        elif intro:
            character_ids = [int(x) for x in intro.get("_characterIds", [])]
            kind, spot, spot_id = "spotEnter", intro, int(intro["_id"])
        elif sheet == "VoiceLocation":
            character_ids = list(dict.fromkeys(character_keys[token] for token in cue.casefold().split("_") if token in character_keys))
            kind, spot, spot_id = "locationConversation", {}, 0
        else:
            continue
        if not character_ids:
            continue
        outputs = direct_cues.get((sheet.casefold(), cue.casefold()), [])
        sounds = [_output_sound(data, cri, output) for cri, output in outputs] or [data.sound(sound_id)]
        for index, sound in enumerate(sounds, 1):
            speakers = {
                character_keys[match[1].casefold()]
                for alias in str((sound or {}).get("cueName") or "").split(";")
                if (match := re.fullmatch(r"spot_\d+_\d+_\d+_([A-Za-z]+)_\d+", alias.strip(), re.I))
                and match[1].casefold() in character_keys
            } if intro else set()
            key = f"location:{sound_id}:{index}"
            entries[key] = {
                "voiceKey": key, "voiceGroup": "location", "voiceKind": kind,
                "masterId": sound_id, "characterIds": sorted(speakers) if speakers else character_ids, "spotId": spot_id,
                "title": data.text(spot.get("_nameTextId")) if spot else None,
                "sound": sound, "sourceTable": "MasterSound", "raw": row,
                **({"variantNumber": index} if len(sounds) > 1 else {}),
            }

    result = {}
    for key, entry in entries.items():
        group = entry["voiceGroup"]
        if group in ("normal", "realLive", "feature", "seasonal", "birthday"):
            entry["collectionTab"] = 0
        elif group == "growth":
            entry["collectionTab"] = 1
        elif group == "gacha":
            entry["collectionTab"] = 2
        elif group not in ("location", "title", "other"):
            entry["collectionTab"] = 3
        lines = entry.get("lines", [entry])
        count = max((len((line.get("sound") or {}).get("variants", [])) for line in lines), default=0)
        if not count:
            result[key] = entry
            continue
        recordings = []
        for index in range(count):
            def variant(line):
                sound = line.get("sound") or {}
                options = sound.get("variants", [])
                return {**line, "sound": options[index % len(options)] if options else sound}
            value = {"variantNumber": index + 1}
            if "lines" in entry:
                value["lines"] = [variant(line) for line in lines]
            else:
                value["sound"] = variant(entry)["sound"]
            recordings.append(value)
        result[key] = {**entry, "recordings": recordings}
    return result
