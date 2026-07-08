Drop shared engine/dependency jar(s) here.

Examples:
- fungraphics-1.5.15.jar
- gdx2d-demoDesktop-1.2.2.jar

The build pipeline scans this folder as a fallback when a student repo does not
commit its own engine jar. You can also force exact fallback jars from server/.env:

Single jar:
GAME_DEPENDENCY_JARS=server/vendor/gdx2d-demoDesktop-1.2.2.jar

Full gdx2d fallback set:
GAME_DEPENDENCY_JARS=server/vendor/gdx2d-demoDesktop-1.2.2.jar;server/vendor/gdx2d-desktop-1.2.2.jar;server/vendor/accordion-1.2.0-jar-with-dependencies.jar

Use ; on Windows, : on macOS/Linux, or commas on any OS to list multiple jars.
