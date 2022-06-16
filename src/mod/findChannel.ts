import log from "./logger";

const allowChannels = ["模拟抽卡"];
const allowGuilds = ["碧蓝档案", "BA彩奈bot专属频道"];

export function findChannel(saveGuilds: SaveGuild[], checkId: string): boolean {

    for (let i = 0; i < saveGuilds.length; i++) {
        const e = saveGuilds[i];
        //log.debug(`search guilds`);
        for (let j = 0; j < e.channel.length; j++) {
            const f = e.channel[j];

            for (let k = 0; k < allowChannels.length; k++) {
                const element = allowChannels[k];
                if (f.name.includes(element) && checkId == f.id) return true;
            }

        }

    }
    return false;
}

export function findGuilds(saveGuildsTree: SaveGuild[], guildId: string): boolean {

    for (let i = 0; i < saveGuildsTree.length; i++) {
        const saveGuild = saveGuildsTree[i];

        if (saveGuild.id == guildId) {
            //log.debug(saveGuild.name);
            for (let k = 0; k < allowGuilds.length; k++) {
                const guildName = allowGuilds[k];
                //log.debug(`|${guildName}|${saveGuild.name}|`);
                //log.debug(guildName == saveGuild.name);
                if (guildName == saveGuild.name) return true;
            }
        }
    }

    return false;
}