import os from "os";
import { Databaser } from "../mod/databaser";
import { Messager } from "../mod/messager";




export async function commandStatus(pusher: Databaser, messager: Messager) {

    pusher.sendMsg(messager, `系统信息: ${os.release()}\n系统内存: ${(os.freemem() / 1024 / 1024).toFixed()}MB/${(os.totalmem() / 1024 / 1024).toFixed()}MB\n系统已开机: ${os.uptime()}s`);
}