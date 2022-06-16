import choicesList from "../file/choices.json"
import log from "./logger";



export function randChoice(times: number): string {

    var content = (times == 10) ? `进行了一次十连,活动限定up中\n----------\n` : `进行了一次单抽,抽中了:`;

    //三星角色（彩色卡背）的抽取概率为2.5，二星角色（金色卡背）为18.5，一星角色（灰色卡背）为79

    if (times == 1) {
        var o = once();
        return content += `(${choicesList.starString[o.star]})${o.name}`;
    } else {
        var must = true;
        for (let index = 0; index < times - 1; index++) {
            var o = once();
            if (o.star > 1) must = false;
            content += `(${choicesList.starString[o.star]})${o.name}\n`;
        }
        var o = once();
        if (o.star == 1 && must) content += `*(已强制保底)(${choicesList.starString[2]})${once().name}\n`;
        else content += `(${choicesList.starString[o.star]})${o.name}\n`

        return content + "----------\n出货情况仅供娱乐，具体请以游戏内为准";
    }

}

function once(must?: boolean): { name: string, star: number } {
    var rNum = parseInt((Math.random() * 1000).toString());
    //log.debug(rNum);
    if (must) return { name: second(2), star: 2 };
    if (rNum <= 25) {
        return { name: second(3), star: 3 };
    } else if (rNum <= 25 + 185) {
        return { name: second(2), star: 2 };
    } else {
        return { name: second(1), star: 1 };
    }
}

/**
 * 根据星级，返回该星级随机出来的名称
 * @param star 星级
 * @returns 角色名称
 */
function second(star: number): string {
    if (star == 3) {
        var c = parseInt((Math.random() * 1000).toString()) % choicesList.star3.length;
        log.info(star + choicesList.star3[c]);
        return choicesList.star3[c];
    } else if (star == 2) {
        var c = parseInt((Math.random() * 1000).toString()) % choicesList.star2.length;
        log.info(star + choicesList.star2[c]);
        return choicesList.star2[c];
    } else {
        var c = parseInt((Math.random() * 1000).toString()) % choicesList.star1.length;
        log.info(star + choicesList.star1[c]);
        return choicesList.star1[c];
    }

}