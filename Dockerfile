# ISC Steam — production image (API + built client + Scala/Java build toolchain)

# ---- Stage 1: build the React client ----
FROM node:20-bookworm-slim AS client-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY client client
RUN npm run build -w client

# ---- Stage 2: runtime ----
FROM node:20-bookworm-slim
ENV NODE_ENV=production

ARG SCALA_VERSION=2.13.14
# Linux JDK and Windows jmods MUST be the exact same version:
# jlink refuses to link a java.base jmod from a different JDK build.
ARG JDK_VERSION=21.0.5+11
ARG JAVAFX_VERSION=17.0.13

RUN apt-get update \
  && apt-get install -y --no-install-recommends git curl ca-certificates unzip \
  && rm -rf /var/lib/apt/lists/*

# Linux JDK (Temurin) — runs scalac, jlink, and the API's build pipeline
RUN JDK_ENC=$(echo "${JDK_VERSION}" | sed 's/+/%2B/') \
  && curl -fsSL "https://api.adoptium.net/v3/binary/version/jdk-${JDK_ENC}/linux/x64/jdk/hotspot/normal/eclipse" -o /tmp/jdk.tar.gz \
  && mkdir -p /opt/jdk \
  && tar -xzf /tmp/jdk.tar.gz -C /opt/jdk --strip-components=1 \
  && rm /tmp/jdk.tar.gz

# Windows JDK jmods (same version) — used by jlink to cross-build the Windows
# Java runtime bundled with each game package
RUN JDK_ENC=$(echo "${JDK_VERSION}" | sed 's/+/%2B/') \
  && curl -fsSL "https://api.adoptium.net/v3/binary/version/jdk-${JDK_ENC}/windows/x64/jdk/hotspot/normal/eclipse" -o /tmp/winjdk.zip \
  && unzip -q /tmp/winjdk.zip -d /tmp/winjdk \
  && mkdir -p /opt/windows-jdk \
  && mv /tmp/winjdk/*/jmods /opt/windows-jdk/jmods \
  && rm -rf /tmp/winjdk /tmp/winjdk.zip

# JavaFX Windows jmods — for games with "javafx": true in isc.json
RUN curl -fsSL "https://download2.gluonhq.com/openjfx/${JAVAFX_VERSION}/openjfx-${JAVAFX_VERSION}_windows-x64_bin-jmods.zip" -o /tmp/jfx.zip \
  && unzip -q /tmp/jfx.zip -d /tmp/jfx \
  && mv "/tmp/jfx/javafx-jmods-${JAVAFX_VERSION}" /opt/javafx-jmods \
  && rm -rf /tmp/jfx /tmp/jfx.zip

# Scala (compiles student games)
RUN curl -fsSL "https://github.com/scala/scala/releases/download/v${SCALA_VERSION}/scala-${SCALA_VERSION}.tgz" \
     | tar -xz -C /opt \
  && ln -s "/opt/scala-${SCALA_VERSION}" /opt/scala

ENV JAVA_HOME=/opt/jdk \
    PATH="/opt/jdk/bin:/opt/scala/bin:${PATH}" \
    SCALA_LIBRARY_JAR=/opt/scala/lib/scala-library.jar \
    WINDOWS_JDK_JMODS=/opt/windows-jdk/jmods \
    JAVAFX_JMODS=/opt/javafx-jmods \
    JAVAFX_VERSION=${JAVAFX_VERSION}

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev -w server

COPY server server
COPY --from=client-build /app/client/dist client/dist

EXPOSE 5174
CMD ["node", "server/src/index.js"]
