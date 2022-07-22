import { Databaser } from "../mod/databaser";
import { Messager } from "../mod/messager";




export async function commandStatus(pusher: Databaser, messager: Messager) {



    pusher.sendMsg(messager, "");
}