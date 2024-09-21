import fs from "fs";
import config from "../../config/config";


export class StudentNameAlias extends Array<string> {
    private _data: string[] = [];

    constructor() {
        super();
        this.reload();

        return new Proxy(this, {
            get(target, property) {

                if (typeof target[property as any] === "function" && target._data[property as any] === undefined)
                    return Reflect.get(target, property);

                if (target[property as any] !== Array.prototype[property as any])
                    return Reflect.get(target, property);

                if (typeof property == "string" && Number(property).toString() === property) {
                    const _ = Number(property);
                    property = (_ < 0 ? (target._data.length + _) : _).toString();
                }

                return Reflect.get(target._data, property);
            },
            set(target, property, value) {
                return Reflect.set(property === "_data" ? target : target._data, property, value);
            },
        });

    }

    public push(...item: string[]) {
        super.push(...item);
        this.save();
        return this.length;
    }

    // public filter<S extends string>(predicate: (value: string, index: number, array: string[]) => value is S, thisArg?: any): string[] {
    //     return super.filter(predicate, thisArg);
    // }

    /**
     * 已集成 save
     * @param value 要删除的 value
     */
    public remove(value: string | undefined) {
        this._data = this._data.filter(v => v != value);
        this.save();
    }

    public reload() {
        this._data = fs.readFileSync(config.studentNameAlias).json();
    }

    async save() {
        fs.writeFileSync(config.studentNameAlias, strFormat(this._data));
    }

}


export class StudentInfo extends Object implements Record<`${number}`, StudentData> {
    private _data: Record<string, StudentData> = {};
    [key: `${number}` | number]: StudentData;
    constructor(reload = true) {
        super();
        if (reload) this.reload();

        return new Proxy(this, {
            get(target, property) {
                const _p = property as keyof typeof target;

                if (typeof target[_p] === "function" && target._data[property as any] === undefined)
                    return Reflect.get(target, property);

                if (property in target && !(property in target._data))
                    return Reflect.get(target, property);

                return Reflect.get(target._data, property);
            },
            set(target, property, value) {
                return Reflect.set(property === "_data" ? target : target._data, property, value);
            },
            ownKeys(target) {
                return Reflect.ownKeys(target._data);
            },
            has(target, property) {
                // Control property existence check
                const prop = property as string;
                return prop in target._data;
            },
            getOwnPropertyDescriptor(target, p) {
                return Reflect.getOwnPropertyDescriptor(target._data, p);
            },

        });
    }

    public values(): StudentData[] {
        return Object.values(this._data);
    }

    public reload() {
        this._data = fs.readFileSync(config.studentInfo).json();
    }

    public async save() {
        fs.writeFileSync(config.studentInfo, strFormat(this._data));
    }
}
