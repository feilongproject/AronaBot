import { MessageType } from "../src/libs/IMessageEx";

export default {
    desc: "命令总览json,按照顺序进行匹配",
    command: {
        test: {
            test: {
                reg: /test/,
                fnc: "test",
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                channelAllows: ["all"],
                describe: "测试测试测试测试（确信）"
            }
        },
        help: {
            help: {
                reg: /^\/?(help|menu|帮助|菜单)$/,
                fnc: "help",
                type: [MessageType.GUILD, MessageType.GROUP],
                channelAllows: ["all"],
                describe: "获取全局帮助"
            }
        },
        pusher: {
        },
        admin: {
            dmsMe: {
                reg: /^\/?dmsme/,
                fnc: "dmsMe",
                type: [MessageType.GUILD],
                channelAllows: ["all"],
                describe: "创建一个私信会话并pong"
            },
            ping: {
                reg: /^\/?ping/,
                fnc: "ping",
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                channelAllows: ["all"],
                describe: "检测redis数据库是否正常"
            },
            status: {
                reg: /^\/?(状态|status)$/,
                fnc: "status",
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                channelAllows: ["all"],
                describe: "查询bot与服务器状态",
                export: "/状态"
            },
            hotLoad: {
                reg: /^\/?热(加载|更新)\s*(-?\d+)$/,
                fnc: "hotLoad",
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                channelAllows: ["all"],
                describe: "开启或关闭热加载"
            },
            reloadStudentData: {
                reg: /^学生数据(网络|本地)重加载$/,
                fnc: "reloadStudentData",
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                channelAllows: ["all"],
                describe: "重加载学生数据"
            },
            dumpChatRecord: {
                reg: /^dump\s*(\d+)$/,
                fnc: "dumpChatRecord",
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                channelAllows: ["all"],
                describe: "dump发言记录"
            },
            restart: {
                reg: /^\/?(restart|重启)$/,
                fnc: "restart",
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                describe: "重启机器人"
            },
            sendTopMessage: {
                reg: /^\/?stm/,
                fnc: "sendTopMessage",
                type: [MessageType.GUILD],
                channelAllows: ["all"],
                describe: "向指定子频道发送消息并置顶"
            }
        },
        mute: {
            mute: {
                reg: /(抽卡|晒卡)?禁言(\d+)((分钟?|m)|(小?时|h)|(天|d))/,
                fnc: "mute",
                channelAllows: ["all"],
                type: [MessageType.GUILD],
                describe: "管理员对某人禁言"
            },
            ban: {
                reg: /(un)?ban1?/,
                fnc: "ban",
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                describe: "对某用户/群聊/频道执行封禁"
            }
        },
        gacha: {
            gachaString: {
                reg: /^\/?(单抽出奇迹|十连大保底)/,
                fnc: "gachaString",
                type: [MessageType.GUILD, MessageType.GROUP, MessageType.FRIEND],
                describe: "以文本形式展示抽卡结果",
                export: "/单抽出奇迹 \n/十连大保底"
            },
            gachaImage: {
                reg: /^\/?十连(保底图)?/,
                fnc: "gachaImage",
                type: [MessageType.GUILD, MessageType.GROUP, MessageType.FRIEND],
                describe: "以图片形式展示抽卡结果",
                export: "/十连保底图"
            },
            reloadGachaData: {
                reg: /^抽卡数据(网络|本地)重加载$/,
                fnc: "reloadGachaData",
                channelAllows: ["all"],
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                describe: "重加载抽卡数据"
            }
        },
        ALA: {
            generateALA: {
                reg: /^\/?奥利奥/,
                fnc: "generateALA",
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                describe: "一起合成爱丽丝吧！",
                export: "/奥利奥 [合成配方]"
            }
        },
        sign: {
            sign: {
                reg: /^\/?签到$/,
                fnc: "sign",
                type: [MessageType.GUILD],
                describe: "进行一次签到（现已暂停维护）",
                export: "/签到"
            }
        },
        sponsor: {
            sponsor: {
                reg: /^\/?(赞助|用爱发电|为爱发电)$/,
                fnc: "sponsor",
                type: [MessageType.GUILD, MessageType.DIRECT],
                describe: "赞助！是赞助！"
            }
        },
        handbook: {
            totalAssault: {
                reg: /^\/?总力战一图流/,
                fnc: "handbookMain",
                channelAllows: ["all"],
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                describe: "总力战一图流",
                export: "/总力战一图流 [国际服|日服]"
            },
            clairvoyance: {
                reg: /^\/?(千|万)里眼/,
                fnc: "handbookMain",
                channelAllows: ["all"],
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                describe: "获取国际服/国服千里眼",
                export: "/千里眼"
            },
            activityStrategy: {
                reg: /^\/?活动攻略/,
                fnc: "handbookMain",
                channelAllows: ["all"],
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                describe: "获取当前活动攻略一图流",
                export: "/活动攻略 [国际服|日服]"
            },
            studentEvaluation: {
                reg: /^\/?(角评|角色评价)/,
                fnc: "handbookMain",
                channelAllows: ["all"],
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                describe: "获取指定学生的评价",
                export: "/角评 [学生名称]"
            },
            handbookUpdate: {
                reg: /^\/?hbupdate/,
                fnc: "handbookUpdate",
                channelAllows: ["all"],
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                describe: "更新攻略中的图片"
            },
            activityStrategyPush: {
                reg: /攻略(发布|更新)\s*(cv\d+)?\s*(\d+)?/,
                fnc: "activityStrategyPush",
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                describe: "进行一个活动攻略的更新"
            },
            searchHandbook: {
                reg: /^\/?((查询|搜索)攻略|攻略(查询|搜索))/,
                fnc: "searchHandbook",
                channelAllows: ["all"],
                type: [MessageType.GUILD, MessageType.GROUP, MessageType.GROUP, MessageType.FRIEND],
                describe: "从diyigemt的API中查询攻略",
                export: "/查询攻略 <攻略名称>"
            }
        },
        commandSetting: {
            commandSetting: {
                reg: /^\/?命令设置/,
                fnc: "commandSetting",
                channelAllows: ["all"],
                type: [MessageType.GUILD, MessageType.GROUP, MessageType.FRIEND],
                describe: "对使用中的命令进行设置",
                export: "/命令设置 [设置选项]"
            }
        },
        serverStatus: {
            baServerStatus: {
                reg: /^\/?服务器状态$/,
                fnc: "baServerStatus",
                channelAllows: ["all"],
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                describe: "查询ba服务器状态",
                export: "/服务器状态"
            }
        },
        AvalonSystem: {
            addWatchList: {
                reg: /^阿瓦隆添加\s*(\d*)$/,
                fnc: "addWatchList",
                channelAllows: ["AvalonSystem"],
                type: [MessageType.GUILD],
                describe: "向阿瓦隆系统添加监控列表"
            },
            unWatchList: {
                reg: /^阿瓦隆删除\s*(\d*)$/,
                fnc: "unWatchList",
                channelAllows: ["AvalonSystem"],
                type: [MessageType.GUILD],
                describe: "向阿瓦隆系统删除监控列表"
            },
            accuseGacha: {
                reg: /^\/?(举报晒卡|晒卡举报)$/,
                fnc: "accuseGacha",
                channelAllows: ["all"],
                type: [MessageType.GUILD],
                describe: "举报晒卡行为"
            },
            accuseGachaUpdate: {
                reg: /^\/?举报图库更新$/,
                fnc: "accuseGachaUpdate",
                channelAllows: ["all"],
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                describe: "更新晒卡举报图中的图库"
            },
            searchMembers: {
                reg: /^\/?阿瓦隆搜索/,
                fnc: "searchMembers",
                channelAllows: ["all"],
                type: [MessageType.GUILD, MessageType.DIRECT],
                describe: "在阿瓦隆记录里通过名字搜索id"
            }
        },
        biliDynamic: {
            mainCheck: {
                reg: /^\/?check$/,
                fnc: "mainCheck",
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                describe: "手动检查一次推送"
            },
            biliDynamicByid: {
                reg: /bilidid/,
                fnc: "biliDynamicByid",
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                describe: "使用指定动态id手动获取截图"
            },
        },
        roleAssign: {
            createVirtualRole: {
                reg: /^\/?创建虚拟身份组/,
                fnc: "createVirtualRole",
                type: [MessageType.GUILD],
                channelAllows: ["all"],
                describe: "创建一个虚拟身份组"
            },
            createRoleAssignMsg: {
                reg: /^\/?创建身份组分配消息/,
                fnc: "createRoleAssignMsg",
                type: [MessageType.GUILD],
                channelAllows: ["all"],
                describe: "创建一个身份组分配消息"
            },
            deleteRoleAssign: {
                reg: /^\/?删除虚拟身份组/,
                fnc: "deleteRoleAssign",
                type: [MessageType.GUILD],
                channelAllows: ["all"],
                describe: "删除虚拟身份组及相关内容"
            }
        },
        Tarot: {
            todayTarot: {
                reg: /^\/?塔罗牌$/,
                fnc: "todayTarot",
                type: [MessageType.GUILD, MessageType.GROUP, MessageType.FRIEND],
                describe: "抽取今日塔罗牌",
                export: "/塔罗牌"
            }
        },
        logo: {
            baLogo: {
                reg: /^\/?[Bb][Aa][-_]?[Ll][Oo][Gg][Oo]/,
                fnc: "baLogo",
                type: [MessageType.GUILD, MessageType.GROUP, MessageType.FRIEND],
                describe: "生成ba特色的logo",
                channelAllows: ["all"],
                export: "/balogo <左文本> <右文本>"
            }
        },
        studentInfo: {
            alias: {
                reg: /\/?alias/,
                fnc: "alias",
                type: [MessageType.GUILD, MessageType.DIRECT, MessageType.GROUP, MessageType.FRIEND],
                describe: "关联数据库中学生别名",
            }
        },
        translate: {
            translate: {
                reg: /\/?翻译\s*/,
                fnc: "translate",
                type: [MessageType.GROUP, MessageType.FRIEND],
                describe: "资讯站的翻译"
            }
        },
        transcoding: {
            loadFile: {
                reg: /^$/,
                fnc: "loadFile",
                type: [MessageType.FRIEND],
                describe: "资讯站的自动化压制加载脚本"
            },
            startJob: {
                reg: /开始压制/,
                fnc: "startJob",
                type: [MessageType.FRIEND, MessageType.GROUP],
                describe: "资讯站的自动化压制开始脚本"
            },
            statusJob: {
                reg: /压制进度/,
                fnc: "statusJob",
                type: [MessageType.FRIEND, MessageType.GROUP],
                describe: "资讯站的自动化压制状态查询脚本"
            },
            downloadJob: {
                reg: /下载压制/,
                fnc: "downloadJob",
                type: [MessageType.FRIEND, MessageType.GROUP],
                describe: "资讯站的自动化压制后下载脚本"
            },
            clearJob: {
                reg: /清空压制/,
                fnc: "clearJob",
                type: [MessageType.FRIEND, MessageType.GROUP],
                describe: "资讯站的自动化压制清空脚本"
            },
            cancelJob: {
                reg: /取消压制/,
                fnc: "cancelJob",
                type: [MessageType.FRIEND, MessageType.GROUP],
                describe: "资讯站的自动化压制退出脚本"
            },
            help: {
                reg: /压制帮助/,
                fnc: "help",
                type: [MessageType.FRIEND, MessageType.GROUP],
                describe: "资讯站的自动化压制帮助"
            },
            auth: {
                reg: /压制认证/,
                fnc: "auth",
                type: [MessageType.FRIEND, MessageType.GROUP],
                describe: "资讯站的自动化压制认证服务"
            },
        },
        soutubot: {
            soutubot: {
                reg: /搜(图|本子)/,
                fnc: "soutubot",
                type: [MessageType.GROUP, MessageType.FRIEND],
                describe: "soutubot"
            },
        },
        chatbot: {
            chatbot: {
                reg: /^chat/,
                fnc: "chatbot",
                type: [MessageType.FRIEND, MessageType.GROUP],
                describe: "deepseekAI对话",
            },
        },
        wifu: {
            wifuToday: {
                reg: /^\/?\s*今日老婆/,
                fnc: "wifuToday",
                type: [MessageType.GROUP],
                describe: "选择今日老婆",
            },
            wifuDelete: {
                reg: /^\/?\s*(今日)?离婚/,
                fnc: "wifuDelete",
                type: [MessageType.GROUP],
                describe: "与今日老婆离婚",
            },
        },
    },
    channelAllows: {
        common: [
            { id: "7465750", name: "碧蓝档案(7487571598174764531)-📨模拟抽卡&每日签到区 (小程序摸了)(7465750)" },
            { id: "638584980", name: "彩奈&星奈测试频道(2175103623165659414) [测试子频1|638584980]" },
            { id: "633688997", name: "蔚蓝档案(16392937652181489481)-模拟抽卡（牌）区😎👌(633688997)" }
        ],
        violate: [{ id: "7730184", name: "碧蓝档案(7487571598174764531)-陶片放逐区&三百人议事会(7730184)" }],
        dev: [
            { id: "638584980", name: "彩奈&星奈测试频道(2175103623165659414) [测试子频1|638584980]" },
            { id: "12156164", name: "频道{BA彩奈bot测试频道}[图片测试频道|12156164]" }
        ],
        AvalonSystem: [{ id: "519695851", name: "碧蓝档案_阿瓦隆(13281105882878427654)-指令中枢(519695851)" }]
    }
} as CommandConfig.Root;
