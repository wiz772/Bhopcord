# [<img src="./browser/icon.png" width="40" align="left" alt="Bhopcord">](https://github.com/wiz772/Bhopcord) Bhopcord

[![Bhopbop](https://img.shields.io/badge/Bhopbop-grey?style=flat)](https://github.com/wiz772/Bhopbop)
[![Build](https://github.com/wiz772/Bhopcord/actions/workflows/build.yml/badge.svg)](https://github.com/wiz772/Bhopcord/actions/workflows/build.yml)

Bhopcord est un fork personnalisé d'[Equicord](https://github.com/Equicord/Equicord) avec des plugins et modifications supplémentaires.

## Installing / Uninstalling

### Avec l'installateur (Bhoplotl)

Windows

- [GUI](https://github.com/wiz772/Bhoplotl/releases/latest/download/Bhoplotl.exe)
- [CLI](https://github.com/wiz772/Bhoplotl/releases/latest/download/BhoplotlCli.exe)

Linux

- [GUI](https://github.com/wiz772/Bhoplotl/releases/latest/download/Bhoplotl-x11)
- [CLI](https://github.com/wiz772/Bhoplotl/releases/latest/download/BhoplotlCli-Linux)

### Installation manuelle (Devbuild)

#### Dependencies

[Git](https://git-scm.com/download) and [Node.JS LTS](https://nodejs.dev/en/) are required.

Install `pnpm`:

> :exclamation: This next command may need to be run as admin/root depending on your system, and you may need to close and reopen your terminal for pnpm to be in your PATH.

```shell
npm i -g pnpm
```

> :exclamation: **IMPORTANT** Make sure you aren't using an admin/root terminal from here onwards. It **will** mess up your Discord/Bhopcord instance and you **will** most likely have to reinstall.

Clone Bhopcord:

```shell
git clone https://github.com/wiz772/Bhopcord
cd Bhopcord
```

Install dependencies:

```shell
pnpm install --frozen-lockfile
```

Build Bhopcord:

```shell
pnpm build
```

Inject Bhopcord into your desktop client:

```shell
pnpm inject
```

## Credits

Merci à [Vendicated](https://github.com/Vendicated) pour [Vencord](https://github.com/Vendicated/Vencord) et à l'équipe d'[Equicord](https://github.com/Equicord/Equicord) pour leur travail.

## Disclaimer

Discord is trademark of Discord Inc., and solely mentioned for the sake of descriptivity.
Mentioning it does not imply any affiliation with or endorsement by Discord Inc.

<details>
<summary>Using Bhopcord violates Discord's terms of service</summary>

Client modifications are against Discord's Terms of Service.

However, Discord is pretty indifferent about them and there are no known cases of users getting banned for using client mods! So you should generally be fine if you don't use plugins that implement abusive behaviour. But no worries, all inbuilt plugins are safe to use!

Regardless, if your account is essential to you and getting disabled would be a disaster for you, you should probably not use any client mods (not exclusive to Bhopcord), just to be safe.

Additionally, make sure not to post screenshots with Bhopcord in a server where you might get banned for it.

</details>
