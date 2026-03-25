import fs from "fs";
import readline from "readline";
import "../src/init";
import { StudentInfo } from "../src/libs/globalVar";
import { sutdentNameFuzzySearch } from "../src/plugins/studentInfo";
import config from "../config/config";


global.studentInfo = new StudentInfo();

const undefNames: string[] = fs.readFileSync(config.studentNameAlias).json();
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});
rl.setPrompt(`选择id(0为删除当前词)`);

for (const undefName of undefNames) {
    const result = sutdentNameFuzzySearch(undefName);

    for (const re of result) {
        console.log(re.name, re.pinyin, re.score);

    }

    debugger;

    console.log("----------\n");

}

