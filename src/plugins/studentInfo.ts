import fs from "fs";
import pinyin from "pinyin";
import jieba from "nodejieba";
import fetch from 'node-fetch';
import { uniqBy } from "lodash";
import PinyinMatch from "pinyin-match";
import { sendToAdmin } from "../libs/common";
import { IMessageDIRECT, IMessageGROUP, IMessageGUILD } from "../libs/IMessageEx";
import config from '../../config/config';


const nameToId = { jp: 0, global: 1 };
var key: keyof typeof nameToId;
const searchPinyin: SearchPinyin[] = [];
jieba.load({ userDict: config.studentNameDict });
if (!searchPinyin.length && global.studentInfo) updateSearchPinyin();

export async function reloadStudentInfo(type: "net" | "local"): Promise<"net ok" | "local ok" | "ok"> {

    const _studentInfo: Record<string, StudentInfo> = {};
    if (type == "net") {
        const [netStudentsSchaleDB, netStudentsElectricgoat, aliasStudentNameWeb] = await Promise.all([
            fetch("https://raw.gh.schale.top/lonqie/SchaleDB/main/data/cn/students.min.json", {
                timeout: 30 * 1000,
            }).then(res => res.json()).then((json: StudentInfoNet[]) => json.map(v => ({ ...v, Name: fixName(v.Name) }))).catch(err => log.error(err)),

            fetch(`https://raw.gh.schale.top/electricgoat/ba-data/jp/Excel/CharacterExcelTable.json`, {
                timeout: 30 * 1000,
            }).then(res => res.json()).then((characterExcelTable: CharacterExcelTable.Root) => {
                return characterExcelTable.DataList.filter(v => v.TacticEntityType == "Student" && v.ProductionStep == "Release" && v.IsPlayableCharacter);
            }).catch(err => log.error(err)),

            fetch("https://raw.gh.schale.top/lgc2333/bawiki-data/main/data/stu_alias.json", {
                timeout: 30 * 1000,
            }).then(res => res.json()).then((json: Record<string, string[]>) => {
                for (const names in json) json[names] = json[names].map(v => fixName(v));
                return json;
            }).catch(err => log.error(err)),
        ]);
        if (!netStudentsSchaleDB) throw `can't fetch json:netStudentsSchaleDB`;
        if (!netStudentsElectricgoat) throw `can't fetch json:netStudentsElectricgoat`;
        if (!aliasStudentNameWeb) throw `can't fetch json:aliasStudentNameWeb`;

        const aliasStudentNameLocal: Record<string, string[]> = JSON.parse(fs.readFileSync(config.aliasStudentNameLocal, { encoding: "utf8" }));

        for (const _ of netStudentsElectricgoat) {
            const __ = netStudentsSchaleDB.find(v => v.Id == _.Id);
            const d = { ..._, ...__, };

            if (!__) await sendToAdmin(`SchaleDB未更新: ${d.Id}-${d.DevName}`);
            const devName = d.DevName[0].toUpperCase() + d.DevName.slice(1);
            _studentInfo[d.Id] = {
                id: d.Id,
                releaseStatus: d.IsReleased || [false, false, false],
                name: [d.Name, fixName(d.DevName), String(d.Id), d.PathName ? fixName(d.PathName) : undefined].filter(v => v) as string[],
                devName: devName,
                pathName: d?.PathName || d.DevName,
                star: d.DefaultStarGrade as 1 | 2 | 3,
                limitedType: d?.IsLimited ?? -1,
            };

            const nameAlis = () => {
                for (const _ of _studentInfo[d.Id].name) {
                    const webHas = aliasStudentNameWeb[_];
                    const localHas: string[] | undefined = aliasStudentNameLocal[_];

                    if (webHas) {
                        _studentInfo[d.Id].name.push(...webHas.filter(v => !v.includes("老婆"))); // 去除私货
                        delete aliasStudentNameWeb[_];
                    }

                    if (localHas) {
                        _studentInfo[d.Id].name.push(...localHas); // 增加本地别名
                        delete aliasStudentNameLocal[_];
                    }
                }
            }
            nameAlis(); nameAlis();

            _studentInfo[d.Id].name = _studentInfo[d.Id].name.filter((v, i, arr) => arr.indexOf(v, 0) === i); // 去重

            if (!fs.existsSync(`${config.images.characters}/Student_Portrait_${devName}.png`))
                throw `not found png file in local: Student_Portrait_${devName}`;
        }

        const unkownWebKeys = Object.keys(aliasStudentNameWeb);
        if (unkownWebKeys.length) await sendToAdmin(`web别名链接失败部分: ${unkownWebKeys.join()}`);
        const unkownLocalKeys = Object.keys(aliasStudentNameWeb);
        if (unkownLocalKeys.length) await sendToAdmin(`local别名链接失败部分: ${unkownLocalKeys.join()}`);

        global.studentInfo = _studentInfo;
        fs.writeFileSync(config.studentInfo, stringifyFormat(_studentInfo));
    }

    if (fs.existsSync(config.studentInfo)) {
        global.studentInfo = JSON.parse(fs.readFileSync(config.studentInfo).toString());
        updateSearchPinyin();
        return `${type} ok`;
    } else return reloadStudentInfo("net");
}

export function findStudentInfo(name: string): StudentInfo | null {
    for (const id in studentInfo) if (studentInfo[id].name.includes(fixName(name))) return studentInfo[id];
    return null;
}

function updateSearchPinyin() {
    searchPinyin.length = 0;
    searchPinyin.push(...Object.values(studentInfo).map(v => uniqBy(
        v.name.map(exName => ({ id: String(v.id), name: exName, pinyin: toPinyin(exName) }))
            .filter(s => !/^(ch)?\d{4,5}$/.exec(s.pinyin)) // 去除id类型
            .filter(s => /^[a-z0-9]+$/.exec(s.pinyin)) // 去除特殊字符
            .filter(s => s.pinyin != s.name)
        , "pinyin")
    ).flat());
}

export function sutdentNameFuzzySearch(source: string, limit = 4): SearchResultScore[] {
    source = source.replace(
        /[\u3002\uff1f\uff01\uff0c\u3001\uff1b\uff1a\u201c\u201d\u2018\u2019\uff08\uff09\u300a\u300b\u3008\u3009\u3010\u3011\u300e\u300f\u300c\u300d\ufe43\ufe44\u3014\u3015\u2026\u2014\uff5e\ufe4f\uffe5]/g,
        ""
    ).replace(/[.,/#!$%^&*;:{}=\-_`~\(\)]/g, "").replace(/\s{2,}/g, " ").trim();
    const sourceCut = jieba.cut(source);
    const searchResult: SearchResultScore[] = uniqBy(searchPinyin
        .map((item) => {
            // 拼音一致加1分
            let score = sourceCut.map((ch) => {
                let score = 0;
                if (PinyinMatch.match(item.name, toPinyin(ch))) {
                    score++;
                }
                if (PinyinMatch.match(source, item.pinyin)) {
                    score++;
                }
                return score;
            }).reduce((p, c) => p + c, 0);
            // 字一样加5分
            score += [...(new Set(item.name.split("")))].map((ch) => {
                if (PinyinMatch.match(source, toPinyin(ch))) {
                    return Number(5);
                } else {
                    return Number(0);
                }
            }).reduce((p, c) => p + c, 0);
            // 减去长度绝对值
            score -= Math.abs(item.name.length - source.length);
            // 加上分数加成
            return { ...item, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score), "id");
    const maxScore = searchResult[0]?.score || -1;
    const maxScoreLength = searchResult.findIndex(v => v.score == maxScore) + 1;
    return searchResult.slice(0, Math.max(maxScoreLength, limit)).map(v => ({ ...v, name: studentInfo[v.id].name[0], }));
}

function toPinyin(han: string): string {
    // 去掉标点符号
    const hanR = han.replace(
        /[\u3002\uff1f\uff01\uff0c\u3001\uff1b\uff1a\u201c\u201d\u2018\u2019\uff08\uff09\u300a\u300b\u3008\u3009\u3010\u3011\u300e\u300f\u300c\u300d\ufe43\ufe44\u3014\u3015\u2026\u2014\uff5e\ufe4f\uffe5]/g,
        ""
    ).replace(/[.,/#!$%^&*;:{}=\-_`~\(\)]/g, "").replace(/\s{2,}/g, " ");
    return pinyin(hanR, { style: "normal" }).flat(1).join("");
}

namespace CharacterExcelTable {
    export interface Root {
        DataList: DataList[];
    }

    export interface DataList {
        Id: number;
        DevName: string;
        ProductionStep: string;
        CollectionVisible: boolean;
        ReleaseDate: string;
        CollectionVisibleStartDate: string;
        CollectionVisibleEndDate: string;
        IsPlayableCharacter: boolean;
        LocalizeEtcId: number;
        Rarity: string;
        IsNPC: boolean;
        TacticEntityType: string;
        CanSurvive: boolean;
        IsDummy: boolean;
        SubPartsCount: number;
        TacticRole: string;
        WeaponType: string;
        TacticRange: string;
        BulletType: string;
        ArmorType: string;
        AimIKType: string;
        School: string;
        Club: string;
        DefaultStarGrade: number;
        MaxStarGrade: number;
        StatLevelUpType: string;
        SquadType: string;
        Jumpable: boolean;
        PersonalityId: number;
        CharacterAIId: number;
        ExternalBTId: number;
        ScenarioCharacter: string;
        SpawnTemplateId: number;
        FavorLevelupType: number;
        EquipmentSlot: string[];
        SpineResourceName: string;
        SpineResourceNameDiorama: string;
        SpineResourceNameDioramaForFormConversion: string;
        EntityMaterialType: string;
        ModelPrefabName: string;
        CafeModelPrefabName: string;
        TextureDir: string;
        TextureEchelon: string;
        CollectionTexturePath: string;
        CollectionBGTexturePath: string;
        UseObjectHPBAR: boolean;
        TextureBoss: string;
        TextureSkillCard: string[];
        TextureSkillCardForFormConversion: string;
        WeaponImagePath: string;
        WeaponLocalizeId: number;
        DisplayEnemyInfo: boolean;
        BodyRadius: number;
        RandomEffectRadius: number;
        HPBarHide: boolean;
        HpBarHeight: number;
        HighlightFloaterHeight: number;
        EmojiOffsetX: number;
        EmojiOffsetY: number;
        MoveStartFrame: number;
        MoveEndFrame: number;
        JumpMotionFrame: number;
        AppearFrame: number;
        CanMove: boolean;
        CanFix: boolean;
        CanCrowdControl: boolean;
        CanBattleItemMove: boolean;
        IsAirUnit: boolean;
        AirUnitHeight: number;
        Tags: string[];
        SecretStoneItemId: number;
        SecretStoneItemAmount: number;
        CharacterPieceItemId: number;
        CharacterPieceItemAmount: number;
        CombineRecipeId: number;
        InformationPacel: string;
        AnimationSSR: string;
        EnterStrategyAnimationName: string;
    }
}
