import OpenAI from "openai";
import { APIPromise } from "openai/core";
import { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources";
import { mailerError } from "../libs/mailer";
import { IMessageGROUP } from "../libs/IMessageEx";
import config from "../../config/config";


const openai = new OpenAI(
    {
        apiKey: config.aiTranslate.apiKey,
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }
);

export async function translate(msg: IMessageGROUP) {
    if (!["E06A1951FA9B96870654B7919DCF2F5C", "57A9BFF9A91410926173B10A33E18E3D"].includes(msg.group_id)) return;
    const postData: ChatCompletionCreateParamsNonStreaming = JSON.parse(JSON.stringify(config.aiTranslate.createParams));


    const translateContent = msg.content.replace(/\/?.?翻译/, "");
    if (devEnv) log.debug(translateContent);
    if (!translateContent) return msg.sendMsgEx({ content: `请输入需要翻译的内容` });
    await msg.sendMsgEx({ content: `正在翻译中，请稍后\n(使用模型: ${postData.model})` }).catch(err => log.error(err));

    postData.messages.push({ role: "user", content: translateContent });

    const translated = await getTranslated(postData);
    if (typeof translated == "string") return msg.sendMsgEx({ content: translated });

    const text: string = formalizeQuotation(translated.choices[0].message.content || "")
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

async function getTranslated(postData: ChatCompletionCreateParamsNonStreaming): Promise<APIPromise<ChatCompletion> | string> {

    for (let i = 0; i < 5; i++) {
        let text;
        try {
            const completion = await openai.chat.completions.create(postData);
            return completion;
        } catch (err) {
            mailerError({ postData, text }, new Error(err as any));
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


