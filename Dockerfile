FROM node:20

LABEL Maintainer="AronaBot docker images by @feilongproject"
LABEL Description="qbot: AronaBot, based on Ubuntu 22.04"

ENV TZ=Asia/Shanghai
ENV WORKSPACE=/app

# RUN apt-get update && apt-get upgrade
WORKDIR /app
COPY ./ /app/
RUN yarn config set sharp_binary_host "https://npmmirror.com/mirrors/sharp" && yarn config set sharp_libvips_binary_host "https://npmmirror.com/mirrors/sharp-libvips" && yarn config set puppeteer-download-base-url "https://cdn.npmmirror.com/binaries/chrome-for-testing" && yarn config set registry "https://registry.npmmirror.com"
RUN yarn install

CMD [ "yarn", "run", "dev:Plana" ]
