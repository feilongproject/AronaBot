import fs from "fs";
import nodemailer from "nodemailer";
import config from "../../config/config";

export async function mailerError(msg: any, err: Error) {
    log.error(err);
    // if (devEnv) return;

    const host = await redis.hGet("config", "sendMail:host");
    const user = await redis.hGet("config", "sendMail:user");
    const pass = await redis.hGet("config", "sendMail:pass");
    const to = await redis.hGet("config", "sendMail:to");
    if (!host || !user || !pass || !to) return;

    const html = fs.readFileSync(config.errorMessageTemaple).toString()
        .replace("%message%", strFormat(msg))
        .replace("%errorName%", err.name)
        .replace("%errorMessage%", err.message)
        .replace("%errorStack%", err.stack || "");

    // writeFileSync("/tmp/html/index.html", html);

    const transporter = nodemailer.createTransport({
        host,
        port: 465,
        secure: true,
        auth: { user, pass },
    });
    return transporter.sendMail({
        subject: `エラー発生。${err.message}`.slice(0, 60),
        from: `"${botType}" <${user}>`, to, html,
    }).catch(err => log.error(err));
}