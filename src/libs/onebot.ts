import axios from 'axios';
import http from 'http';
import https from 'https';
import config from '../../config/config';

const axiosInstance = axios.create({
    baseURL: config.onebot.baseUrl,
    timeout: 180 * 1000,
    httpAgent: new http.Agent({ keepAlive: false }),
    httpsAgent: new https.Agent({ keepAlive: false }),
});

export async function getForwardMessage(mid: string): Promise<Forward.ResposeData> {
    return axiosInstance
        .post<Forward.Respose>(`/get_forward_msg`, {
            message_id: mid,
        })
        .then((res) => res.data.data);
}

export async function getMessage(mid: string): Promise<MessageInfo.ResposeData> {
    return axiosInstance
        .post<MessageInfo.Respose>(`/get_msg`, {
            message_id: mid,
        })
        .then((res) => res.data.data);
}

export async function uploadGroupFile(
    data: UploadGroupFile.Request,
): Promise<UploadGroupFile.ResposeData> {
    return axiosInstance
        .post<UploadGroupFile.Respose>(`/upload_group_file`, data)
        .then((res) => res.data.data);
}

interface CommonRespose<T> {
    data: T;
    message: string;
    retcode: number;
    status: string;
    wording: string;
}

namespace MessageInfo {
    export type Respose = CommonRespose<ResposeData>;

    export interface ResposeData {
        font: number;
        group_id: number;
        message: Message[];
        message_format: string;
        message_id: number;
        message_seq: number;
        message_type: string;
        post_type: string;
        raw_message: string;
        real_id: number;
        self_id: number;
        sender: {
            card: string;
            nickname: string;
            role: string;
            title: string;
            user_id: number;
        };
        sub_type: string;
        time: number;
        user_id: number;
    }

    export interface Message {
        data?: {
            text: string;
        };
        type?: string;
    }
}

namespace Forward {
    export type Respose = CommonRespose<ResposeData>;

    export interface ResposeData {
        messages: Message[];
    }

    export interface Message {
        content: (TextContent | ImageContent | ForwardContent)[];
        message_format: string;
        message_type: string;
        sender?: {
            nickname: string;
            user_id: number;
        };
        time: number;
    }

    export interface TextContent {
        type: 'text';
        data: {
            text: string;
        };
    }

    export interface ImageContent {
        data: {
            file: string;
            file_size: string;
            subType: string;
            url: string;
        };
        type: 'image';
    }

    export interface ForwardContent {
        type: 'forward';
        data: {
            id: string;
        };
    }
}

namespace UploadGroupFile {
    export interface Request {
        file: string;
        folder_id?: string;
        group_id: number;
        name?: string;
    }

    export type Respose = CommonRespose<ResposeData>;

    export interface ResposeData {
        file_id: string;
    }
}
