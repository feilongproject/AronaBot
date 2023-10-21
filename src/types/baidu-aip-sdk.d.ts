declare module 'baidu-aip-sdk' {

    class contentCensor {
        constructor(APP_ID: string, API_KEY: string, SECRET_KEY: string);
        textCensorUserDefined(content: string): Promise<TextCensorUserDefined.Root>;
    }

    namespace TextCensorUserDefined {
        export type Root = {
            log_id: number;
        } & {
            error_code?: number;
            error_msg?: string;
        } & {
            conclusion?: "合规" | "不合规" | "疑似" | "审核失败";
            conclusionType?: 1 | 2 | 3 | 4;
            data?: Daum[];
            isHitMd5?: boolean; // 何时来的
        };

        interface Daum {
            msg: string;
            conclusion: string;
            hits: Hit[];
            subType: number;
            conclusionType: number;
            type: number;
        }

        interface Hit {
            wordHitPositions: WordHitPosition[];
            datasetName: string;
            words: string[];
        }

        interface WordHitPosition {
            keyword: string;
            label: string;
            positions: number[][];
        }
    }

}

