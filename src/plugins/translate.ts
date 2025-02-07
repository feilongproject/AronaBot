import fs from "fs";
import fetch from "node-fetch";
import { IMessageGROUP } from "../libs/IMessageEx";
import config from "../../config/config";


export async function translate(msg: IMessageGROUP) {
    if (!["E06A1951FA9B96870654B7919DCF2F5C", "57A9BFF9A91410926173B10A33E18E3D"].includes(msg.group_id)) return;

    // const { translateContent } = mg.exec(msg.content)?.groups || {};


    const translateContent = msg.content.replace(/\/?.?翻译/, "");
    if (devEnv) log.debug(translateContent);
    if (!translateContent) return msg.sendMsgEx({ content: `请输入需要翻译的内容` });
    await msg.sendMsgEx({ content: `正在翻译中，请稍后` }).catch(err => log.error(err));

    const postData: ApiData.Req = JSON.parse(JSON.stringify(config.aiTranslate.system));
    postData.system = fs.readFileSync(config.aiTranslate.systemPromptFile).toString();
    postData.messages.push({
        role: "user",
        content: [{ type: "text", text: translateContent }],
    });

    const translated = await getTranslated(postData);
    if (typeof translated == "string") return msg.sendMsgEx({ content: translated });

    const text: string = formalizeQuotation(translated.content[0].text)
        .replaceAll("...", "…")
        .replaceAll(".", "。")
        .replaceAll(",", "，");
    return msg.sendMsgEx({
        content: `返回结果:\n` + text,//JSON.stringify(text).slice(1, -1),
    }).catch(err => {
        log.error(err);
        return msg.sendMsgEx({
            content: `发送失败\n` + JSON.stringify(err).replaceAll(".", ","),
        });
    });
}

async function getTranslated(postData: ApiData.Req): Promise<ApiData.Res | string> {

    for (let i = 0; i < 3; i++) {
        let text;
        try {
            const res = await fetch(config.aiTranslate.proxyUrl, {
                method: "POST",
                headers: config.aiTranslate.headers,
                body: JSON.stringify(postData),
            });
            text = await res.text();
            if (res.status != 200) continue;

        } catch (err) {
            (await import("../eventRec")).mailerError({ postData, text }, new Error(err as any));
        }

    }

    return "多次重试未能获取到有效内容，请稍后再试";

}

function contentTokenizer(content: string) {
    const contentToken: ContentToken[] = [];
    let currentPos = 0;
    let quotationMarkCount = 0;
    let singleQuotationMarkCount = 0;
    while (currentPos < content.length) {
        const currentChar = content[currentPos];
        if (['"', '＂', '“', '”', '「', '」'].includes(currentChar)) {
            quotationMarkCount++;
            contentToken.push({
                type: 'QuotationMark',
                value: quotationMarkCount % 2 === 0 ? 'Close' : 'Open',
            });
            currentPos++;
            continue;
        }

        if (["'", '＇', '‘', '’', '『', '』'].includes(currentChar)) {
            singleQuotationMarkCount++;
            contentToken.push({
                type: 'SingleQuotationMark',
                value: singleQuotationMarkCount % 2 === 0 ? 'Close' : 'Open',
            });
            currentPos++;
            continue;
        }

        contentToken.push({
            type: 'Text',
            value: currentChar,
        });
        currentPos++;
    }
    return contentToken;
}

function quotationFormalizer(content: ContentToken[]) {
    let contentString = '';
    for (const token of content) {
        if (token.type === 'QuotationMark') {
            contentString += token.value === 'Open' ? '“' : '”';
        } else if (token.type === 'SingleQuotationMark') {
            contentString += token.value === 'Open' ? '‘' : '’';
        } else {
            contentString += token.value;
        }
    }
    return contentString;
}

function formalizeQuotation(content: string) {
    const contentToken = contentTokenizer(content);
    return quotationFormalizer(contentToken);
}


interface ContentToken {
    type: 'Text' | 'QuotationMark' | 'SingleQuotationMark';
    value: string;
}

namespace ApiData {

    export interface Req {
        model: string;
        max_tokens: number;
        temperature: number;
        system: string;
        messages: {
            role: string;
            content: {
                type: string;
                text: string;
            }[];
        }[];
    }

    export interface Res {
        id: string;
        type: string;
        role: string;
        model: string;
        content: {
            type: string;
            text: string;
        }[];
        stop_reason: string;
        stop_sequence: null;
        usage: {
            input_tokens: number;
            output_tokens: number;
        };
    }
}

