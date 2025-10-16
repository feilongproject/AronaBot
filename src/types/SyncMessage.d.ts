declare interface SyncMessageBody {
    self_id: number;
    user_id: number;
    time: number;
    message_id: number;
    message_seq: number;
    message_type: 'group';
    sender: {
        user_id: number;
        nickname: string;
        card: string;
        role: string;
        title: string;
    },
    raw_message: string;
    font: number;
    sub_type: string;
    message: string;
    message_format: string;
    post_type: string;
    raw: SyncMessageRaw.Root,
    group_id: number;
}

declare namespace SyncMessageRaw {
    interface Root {
        msgId: string;
        msgRandom: string;
        msgSeq: string;
        cntSeq: string;
        chatType: number;
        msgType: number;
        subMsgType: number;
        sendType: number;
        senderUid: string;
        peerUid: string;
        channelId: '',
        guildId: '',
        guildCode: string;
        fromUid: string;
        fromAppid: string;
        msgTime: string;
        msgMeta: string;
        sendStatus: number;
        sendRemarkName: '',
        sendMemberName: string;
        sendNickName: '',
        guildName: '',
        channelName: '',
        elements: Element[],
        records: [],
        emojiLikesList: [],
        commentCnt: string;
        directMsgFlag: number;
        directMsgMembers: [],
        peerName: string;
        freqLimitInfo: null,
        editable: false,
        avatarMeta: '',
        avatarPendant: '',
        feedId: '',
        roleId: string;
        timeStamp: string;
        clientIdentityInfo: null,
        isImportMsg: false,
        atType: number;
        roleType: number;
        fromChannelRoleInfo: { roleId: string; color: 0 },
        fromGuildRoleInfo: { roleId: string; color: 0 },
        levelRoleInfo: { roleId: string; color: 0 },
        recallTime: string;
        isOnlineMsg: true,
        generalFlags: string;
        clientSeq: string;
        fileGroupSize: null,
        foldingInfo: null,
        multiTransInfo: null,
        senderUin: string;
        peerUin: string;
        msgAttrs: {},
        anonymousExtInfo: null,
        nameType: number;
        avatarFlag: number;
        extInfoForUI: null,
        personalMedal: null,
        categoryManage: number;
        msgEventInfo: null
    }

    interface Element {
        elementType: 1 | 17; // 1:textElement  17:inlineKeyboardElement
        inlineKeyboardElement?: InlineKeyboardElement;
        textElement?: TextElement;
    }

    interface TextElement {
        content: string;   // "@星奈"
        atType: number;    // 2
        atUid: string;     // "2854207579"
        atTinyId: string;  // "0",
        atNtUid: string;   // "u_HwRM8zM122Z1ykRkkeH2JQ"
        subElementType: number;
        atChannelId: string;
        linkInfo: null;
        atRoleId: string;
        atRoleColor: number;
        atRoleName: string;
        needNotify: number;
    }

    interface InlineKeyboardElement {
        botAppid: string;
        rows: InlineKeyboardElementRow[];
    }

    interface InlineKeyboardElementRow {
        buttons: InlineKeyboardElementButton[];
    }

    interface InlineKeyboardElementButton {
        type: 1;
        id: string;
        data: string;
    }

}


