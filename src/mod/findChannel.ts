import log from "./logger";

export function findChannel(name: string[], saveGuilds: SaveGuild[], checkId: string): boolean {

    for (let i = 0; i < saveGuilds.length; i++) {
        const e = saveGuilds[i];
        //log.debug(`search guilds`);
        for (let j = 0; j < e.channel.length; j++) {
            const f = e.channel[j];

            for (let k = 0; k < name.length; k++) {
                const element = name[k];
                if (element == f.name && checkId == f.id) return true;
            }

        }

    }
    return false;
}