import fs from 'fs';
import path from 'path';
import pptr from 'puppeteer';
import { decode as htmlDecode } from 'html-entities';
import { IMessageC2C, IMessageGROUP } from '../libs/IMessageEx';

export async function testTwitter(msg: IMessageGROUP | IMessageC2C) {
    let UserTweets = undefined as any;
    let TweetDetail = undefined;

    const browserT = await pptr.launch({
        headless: !process.env.DISPLAY,
        args: ['--no-sandbox', '--proxy-server=127.0.0.1:10809'],
        protocolTimeout: 240000,
    });

    try {
        const page = await browserT.newPage();
        await page.setViewport({
            width: 1920,
            height: 1080,
        });
        page.on('response', async (res) => {
            const url = res.url();
            if (res.request().method() === 'OPTIONS') return;

            if (url.includes('UserTweets')) {
                UserTweets = await res.json();
                // debugger;
            } else if (url.includes('TweetDetail')) {
                TweetDetail = await res.json();
                // debugger;
            }
        });

        await page.goto('https://x.com/Blue_ArchiveJP', {
            waitUntil: 'networkidle0',
            timeout: 60 * 1000,
        });

        const articles = await page.$$eval('article', (v) =>
            v.map((i) => {
                debugger;
                const aTags = i.querySelectorAll('a');
                const ids = [] as string[];
                for (let v = 0; v < aTags.length; v++) ids.push(aTags[v].href);

                return {
                    // html: i.innerHTML,
                    text: i.innerText,
                    id: ids.map((v) => /status\/(?<id>\d+)/.exec(v)?.groups?.id).find((v) => v),
                };
            }),
        );
        // debugger;

        await twitterWarpper(UserTweets, msg);
    } finally {
        await browserT.close();
    }
}

async function twitterWarpper(UserTweets: any, msg: IMessageC2C | IMessageGROUP) {
    const instructions = UserTweets
        ? UserTweets.data.user.result.timeline_v2.timeline.instructions
        : [];

    const posts: TweetPost[] = [];
    for (const instruction of instructions || []) {
        if (instruction.type === 'TimelineClearCache') {
            continue; // 啥也没
        } else if (instruction.type === 'TimelinePinEntry') {
            const entryId: string = instruction.entry.entryId;
            instruction.entry.content.itemContent.socialContext.contextType === 'Pin';
            const legacy = instruction.entry.content.itemContent.tweet_results.result.legacy;

            const media = legacy.entities.media;
            const media_ex = legacy.extended_entities.media as any[];
            const urls = legacy.entities.urls;
            const full_text = legacy.full_text;

            // debugger;
            posts.unshift({
                type: 'pin',
                id: entryId.replace(/^tweet-/, ''),
                fullText: full_text,
                medias: media,
                media_ex: media_ex,
                urls: urls,
                rewardInfo: null,
            });

            // debugger;
        } else if (instruction.type === 'TimelineAddEntries') {
            for (const entry of instruction.entries) {
                const entryId = entry.entryId as string;
                const { displayType, entryType } = entry.content;
                if (
                    entryType === 'TimelineTimelineModule' &&
                    displayType === 'VerticalConversation'
                ) {
                    continue;
                } else if (entryType === 'TimelineTimelineItem' && !displayType) {
                    // console.log("\n===================\n===================\n===================\n");

                    const result = entry.content.itemContent?.tweet_results?.result;
                    if (!result) {
                        debugger;
                        continue;
                    }
                    const _full_text = result.legacy.full_text;
                    const _text = result.note_tweet?.note_tweet_results.result.text;
                    const _media = result.legacy.entities.media as any[] | undefined;
                    const _urls = result.legacy.entities.urls;
                    const _media_ex = result.legacy.extended_entities?.media as any[] | undefined;
                    // console.log(_full_text, _media?.length, _media_ex?.length);
                    // console.log("-------------------");
                    // console.log(_text);// this

                    posts.push({
                        type: 'post',
                        id: entryId.replace(/^tweet-/, ''),
                        text: _text,
                        fullText: _full_text,
                        urls: _urls,
                        medias: _media,
                        media_ex: _media_ex,
                        rewardInfo: result.legacy.retweeted_status_result?.result.legacy,
                        // quoted_status_result: quoted_status_result?.note_tweet?.note_tweet_results.result.text,
                    });

                    const quoted_status_result = result.quoted_status_result?.result;
                    // if (!quoted_status_result) { debugger; continue; }
                    // console.log("===================");

                    // const _quoted_full_text = decode(quoted_status_result.legacy.full_text);
                    // const _quoted_text = quoted_status_result.note_tweet?.note_tweet_results.result.text;

                    // const _quoted_media: any[] | undefined = quoted_status_result.legacy.entities.media;
                    // const _quoted_media_ex: any[] | undefined = quoted_status_result.legacy.extended_entities.media;
                    // console.log(_quoted_full_text, _quoted_media?.length, _quoted_media_ex?.length);
                    // console.log("-------------------");
                    // console.log(_quoted_text); // this

                    // debugger;
                } else if (entryType === 'TimelineTimelineCursor' && !displayType) {
                    // debugger;
                } else debugger;
            }
        } else if (instruction.type === 'TimelineTerminateTimeline') {
            // debugger;
        } else debugger;
    }

    // const _posts: TweetPost[] = Array.from({ length: posts.length });
    // for (const [i, article] of articles.entries()) {
    //     const ii = posts.findIndex(v => v && (v.id === article.id));
    //     if (ii === -1) continue;
    //     _posts[i] = posts[ii];
    //     posts[ii] = undefined as any;
    // }

    debugger;
    // posts.sort(v => articles.findIndex(a => v.entryId.includes(a.id || "")))

    for (const { fullText, medias, urls, media_ex, id, rewardInfo: replayInfo } of posts) {
        if (await redis.hExists('twitter:pushed', id)) continue;

        let retContent = htmlDecode(fullText);

        const imgUrls: string[] = [];
        const videoUrls: string[] = [];
        for (const media of medias || []) {
            if (media.type === 'photo') {
                imgUrls.push(media.media_url_https);
                retContent = retContent.replaceAll(media.url, '');
            } else if (media.type === 'video') {
                videoUrls.push(
                    media.video_info.variants
                        .filter((v) => v.bitrate)
                        .reduce((vP, vC) => (vC.bitrate > vP.bitrate ? vC : vP)).url,
                );
                retContent = retContent.replaceAll(media.url, '');
            } else debugger;
        } // 删除末尾视频链接, 并把媒体类型文件扔到数据库

        for (const url of urls || []) {
            retContent = retContent.replaceAll(url.url, url.expanded_url);
        } // 替换文本链接

        debugger;
        await msg
            .sendMsgEx({ content: `${retContent.replaceAll('.', '\u200b.\u200b')}` })
            .catch(log.error);
        await redis.hSet('twitter:pushed', id, '1');

        continue;
        // for (const [i, videoUrl] of videoUrls.entries()) {
        //     const buffer = await fetch(videoUrl).then((res) => res.buffer());
        //     const ext = path.extname(new URL(videoUrl).pathname);
        //     const key = `twitter/${id}-${i}${ext}`;
        //     const res = await cosPutObject({ Key: key, Body: buffer });
        //     const fileInfo = await msg.sendFile({ fileUrl: cosUrl(key, ''), fileType: 2 });
        //     await msg.sendMsgEx({ fileInfo: fileInfo.result });
        //     debugger;
        // }
    }

    debugger;
}

interface TweetPost {
    type: 'pin' | 'post';
    id: string;
    fullText: string;
    text?: string;
    urls?: TweetUrl[];
    medias?: (TweetMediaUrl | TweetMediaVideo)[];
    media_ex?: any[];
    rewardInfo: any;
}

interface TweetMediaUrl {
    display_url: string;
    expanded_url: string;
    id_str: string;
    indices: [number, number];
    media_key: string;
    media_url_https: string; // useful
    type: 'photo';
    url: string;
    ext_media_availability: { status: 'Available' };
    media_results: { result: { media_key: string } };
}
interface TweetMediaVideo {
    display_url: string;
    expanded_url: string;
    id_str: string;
    indices: [number, number];
    media_key: string;
    media_url_https: string; // 封面？
    type: 'video';
    url: string;
    additional_media_info: { monetizable: false };
    ext_media_availability: { status: 'Available' };
    original_info: {
        height: number;
        width: number;
        focus_rects: [];
    };
    video_info: {
        aspect_ratio: [number, number];
        duration_millis: number;
        variants: {
            bitrate: number;
            content_type: 'application/x-mpegURL' | 'video/mp4';
            url: string;
        }[];
    };
    media_results: { result: { media_key: string } };
}
interface TweetUrl {
    display_url: string;
    expanded_url: string; //
    url: string; //
    indices: [number, number];
}
