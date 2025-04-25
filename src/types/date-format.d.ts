declare module "date-format" {




    const ISO8601_FORMAT = "yyyy-MM-ddThh:mm:ss.SSS";
    const ISO8601_WITH_TZ_OFFSET_FORMAT = "yyyy-MM-ddThh:mm:ss.SSSO";
    const DATETIME_FORMAT = "dd MM yyyy hh:mm:ss.SSS";
    const ABSOLUTETIME_FORMAT = "hh:mm:ss.SSS";

    function asString(date: Date): string;
    function asString(format: string, date?: Date): string;
    function parse(pattern: string, str: string, missingValuesDate?: Date): string;
    function now(): Date;



    //     // module.exports = asString;
    //     // module.exports.asString = asString;
    //     // module.exports.parse = parse;
    //     // module.exports.now = now;

    //     // module.exports.ISO8601_FORMAT = "yyyy-MM-ddThh:mm:ss.SSS";
    //     // module.exports.ISO8601_WITH_TZ_OFFSET_FORMAT = "yyyy-MM-ddThh:mm:ss.SSSO";
    //     // module.exports.DATETIME_FORMAT = "dd MM yyyy hh:mm:ss.SSS";
    //     // module.exports.ABSOLUTETIME_FORMAT = "hh:mm:ss.SSS";

}