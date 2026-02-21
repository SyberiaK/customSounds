# Custom Sounds
A Vencord plugin that allows you to change any native Discord sound.

- Custom audio uploads;
- built-in Discord presets;
- volume control;
- sound preview;
- and importing/exporting your settings.

This fork also features:
- not broken override imports (https://github.com/ScattrdBlade/customSounds/pull/20, [0e31406](https://github.com/SyberiaK/customSounds/commit/0e314067b6339bf75c5224d83864e96848c97192));
- fast uploads of multiple audio files (in one selection);
- a button to quickly delete all added sounds (was very useful in testing).

> [!WARNING]
> <details>
> <summary>Using Vencord violates Discord's terms of service.</summary>
>
> Client modifications are against Discord’s Terms of Service.
>
> However, Discord is pretty indifferent about them and there are no known cases of users getting banned for   using client mods! So you should generally be fine as long as you don’t use any plugins that implement   abusive behaviour. But no worries, all inbuilt plugins (and this one, too) are safe to use!
>
> Regardless, if your account is very important to you and it getting disabled would be a disaster for you,   you should probably not use any client mods (not exclusive to Vencord), just to be safe.
>
> Additionally, make sure not to post screenshots with Vencord in a server where you might get banned for it.
> </details>

## Installation
> [!WARNING]
> Before you start, you should have a [developer build of Vencord](https://docs.vencord.dev/installing/) and all of its prerequisites installed.

1. Open your terminal in Vencord's source code directory.
   - On Windows, you can right-click on the directory and click on **"Open Git Bash here"**.
2. Enter:
```bash
cd src && mkdir userplugins && cd userplugins
git clone https://github.com/SyberiaK/customSounds
```
3. After it's done, make sure to rebuild and reinject Vencord:
```bash
cd ../..
pnpm build
pnpm inject
```
