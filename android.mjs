// Builds the web app, copies it into the Android project and compiles a debug APK.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";

const env = { ...process.env };
env.JAVA_HOME ??= "C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot";
if (!existsSync(env.JAVA_HOME)) throw new Error(`Java blev ikke fundet i ${env.JAVA_HOME}`);

const run = (cmd, cwd = ".") => execSync(cmd, { cwd, stdio: "inherit", env });
run("node build.mjs");
run("npx cap sync android");
run(process.platform === "win32" ? "gradlew.bat assembleDebug" : "./gradlew assembleDebug", "android");
copyFileSync("android/app/build/outputs/apk/debug/app-debug.apk", "Tankemakker.apk");
console.log("APK klar: Tankemakker.apk");
