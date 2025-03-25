#Build
FROM node:22.13.0-alpine3.21 AS build

WORKDIR /app

COPY package.json yarn.lock /app/

RUN yarn install

COPY . /app

RUN yarn tsc

#Run
FROM gcr.io/distroless/nodejs22-debian12 AS run

COPY --from=build /app/dist /app

ENV NODE_ENV=production

CMD ["app/index.js"]