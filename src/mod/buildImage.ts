import sharp from 'sharp';
import config from '../../data/config.json'
import log from './logger';



/**
 * 
 * @returns 返回编辑好的图片路径
 */
export async function buildImage(characterNames: { name: Character, star: number }[]): Promise<string> {


    if (characterNames.length == 1) {
        return "";
    } else if (characterNames.length == 10) {

        var tmpOutPath = `${config.picPath.out}/${new Date().getTime()}.png`;
        var files: { input: string, top: number, left: number, }[] = [];

        characterNames.forEach((value, index) => {

            var x = ((index) % 5);
            var y = parseInt(`${index / 5}`.slice(0, 1));

            //log.debug(`(${x},${y})`);

            x *= 300, x += 120;
            y *= 350, y += 180;

            /* files.push({//character and star bg
                input: `${config.picPath.avatarBg}`,
                top: y - 20,
                left: x - 40,
            }); */

            files.push({//star bg
                input: `${config.picPath.starBg}`,
                top: y + 190,
                left: x - 10,
            });

            files.push({//character bg
                input: `${config.picPath.mask[value.star]}`,
                top: y - 10,
                left: x - 4,
            });


            files.push({//character avatar
                input: `${config.picPath.characters}/${value.name.fileName}`,
                top: y,
                left: x,
            });

            for (let i = 0; i < value.star; i++) {//stars
                files.push({
                    input: `${config.picPath.star}`,
                    top: y + 210,
                    left: x + 30 + i * 60,
                });
            }
        })


        //files.push();

        return sharp(config.picPath.mainBg)
            .composite(files)
            .png({ compressionLevel: 6, quality: 5, })
            .toFile(tmpOutPath).then(() => {
                return tmpOutPath;
            });


    }


    return "";

}


/* function buildTextPic(text: string): Buffer {
    const svg = TextToSVG.loadSync(config.picPath.font);

    return Buffer.from(svg.getSVG(text, {
        fontSize: 10
    }));

} */