# Custom Sounds (Vencord)
This is a Vencord plugin that allows you to change any native Discord sound.

- Custom audio uploads;
- built-in Discord presets;
- volume control;
- sound preview;
- and importing/exporting your settings.

This fork also features:
- not broken override imports (should be fixed in the upstream by https://github.com/ScattrdBlade/customSounds/pull/20)
- actually allowing to upload multiple audio files in one selection!

### Installation
Requires [Git](https://git-scm.com/) to be installed on your system.
> [!WARNING]
> Before you start, you have a [developer build of Vencord](https://docs.vencord.dev/installing/) installed.

1. Open Git Bash in Vencord's source code directory.
   - On Windows, right-click it and click on "Open Git Bash here".
2. Enter:
```bash
cd src && mkdir userplugins && cd userplugins && git clone https://github.com/SyberiaK/customSounds
```
3. After it's done, make sure to rebuild and reinject Vencord:
```bash
cd ../..
pnpm build
pnpm inject
```
