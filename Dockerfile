FROM node:18.14.0-alpine3.17

WORKDIR /app

COPY package.json yarn.lock /app/

RUN yarn install

COPY . /app

RUN yarn tsc

CMD ["node", "src/index.js"]