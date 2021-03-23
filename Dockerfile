FROM node:alpine
ENV dst /opt/nodejs/telegram
RUN mkdir -p $dst
WORKDIR $dst
COPY . .
ENTRYPOINT ["nodejs", "bot.js"]