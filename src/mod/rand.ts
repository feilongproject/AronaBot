import choicesList from "../file/choices.json"
import log from "./logger";

export function randChoice(times: number): string {

    var content = (times == 10) ? `进行了一次十连,出货中\n----------\n` : `进行了一次单抽,抽中了:`;

    //三星角色（彩色卡背）的抽取概率为2.5，二星角色（金色卡背）为18.5，一星角色（灰色卡背）为79

    if (times == 1) {
        var o = once();
        return content += `(${o.star})${o.name}`;
    } else {
        for (let index = 0; index < times - 1; index++) {
            var o = once();
            content += `(${o.star})${o.name}\n`;
        }
        var o = second(2);
        content += `(${o.star})${o.name}\n`
        return content + "----------\n出货情况仅供娱乐，具体请以游戏内为准";
    }



}

function once(): { name: string, star: string } {
    var rNum = parseInt((Math.random() * 1000).toString());
    //log.debug(rNum);
    if (rNum <= 25) {
        return second(3);
    } else if (rNum <= 25 + 185) {
        return second(2);
    } else {
        return second(1);
    }
}

function second(star: number) {
    if (star == 3) {
        var c = parseInt((Math.random() * 1000).toString()) % choicesList.star3.length;
        log.info(choicesList.star3[c]);
        return { name: choicesList.star3[c], star: "★★★" };
    } else if (star == 2) {
        var c = parseInt((Math.random() * 1000).toString()) % choicesList.star2.length;
        log.info(choicesList.star2[c]);
        return { name: choicesList.star2[c], star: "★★" };
    } else {
        var c = parseInt((Math.random() * 1000).toString()) % choicesList.star1.length;
        log.info(choicesList.star1[c]);
        return { name: choicesList.star1[c], star: "★" };
    }

}