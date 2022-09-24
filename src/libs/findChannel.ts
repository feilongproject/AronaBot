const allowChannels = ["7465750", "7730184", "7519851"];
/* 
碧蓝档案(7487571598174764531)-📨模拟抽卡&每日签到区(7465750)-father:7340027
碧蓝档案(7487571598174764531)-陶片放逐区&三百人议事会(7730184)-father:7351235
BA彩奈bot专属频道(9919414431536104110)-模拟抽卡(7519851)-father:7519511
*/

const allowGuilds = ["7487571598174764531", "9919414431536104110", "5237615478283154023"];
/* 
碧蓝档案(7487571598174764531)
BA彩奈bot专属频道(9919414431536104110)
QQ频道机器人测试频道(5237615478283154023)
*/

export function findChannel(checkChannelId: string): boolean {
    //for (const guild of global.saveGuildsTree) {
    //for (const channel of guild.channel) {
    if (allowChannels.includes(checkChannelId)) return true;
    //}
    //}
    return false;
}

export function findGuilds(checkGuildId: string): boolean {
    //return false;
    if (allowGuilds.includes(checkGuildId)) return true;
    return false;
}