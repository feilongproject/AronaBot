const allowGuilds = ['7487571598174764531', '9919414431536104110', '5237615478283154023'];
/* 
碧蓝档案(7487571598174764531)
BA彩奈bot专属频道(9919414431536104110)
QQ频道机器人测试频道(5237615478283154023)
*/

export function findGuilds(checkGuildId: string): boolean {
    //return false;
    if (allowGuilds.includes(checkGuildId)) return true;
    return false;
}
