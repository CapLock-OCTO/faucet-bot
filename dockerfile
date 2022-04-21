# production images
FROM node:16 as builder
WORKDIR /app
COPY . .
RUN yarn
RUN yarn build

FROM node:16-alpine
ENV TZ utc
WORKDIR /app

RUN apk add --no-cache tini
COPY . .
RUN yarn install --prod
COPY --from=builder /app/dist /app/dist

ENTRYPOINT ["/sbin/tini", "--", "node", "dist/src/index"]

