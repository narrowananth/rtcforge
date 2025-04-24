# ZSH Terminal Setup Guide (with Spaceship Theme)

This guide outlines the complete setup for configuring a beautiful and productive ZSH terminal on macOS, including the Spaceship theme and essential plugins.

---

## 🧰 Prerequisites

-   Homebrew must be installed. If not, install it with:
    ```bash
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    ```

---

## 1️⃣ Install ZSH (if not already installed)

```bash
brew install zsh
```

---

## 2️⃣ Set ZSH as the default shell

```bash
chsh -s /bin/zsh
```

Restart your terminal to apply changes.

---

## 3️⃣ Install Oh My Zsh

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
```

---

## 4️⃣ Install Spaceship Prompt Theme

```bash
git clone https://github.com/spaceship-prompt/spaceship-prompt.git "$ZSH_CUSTOM/themes/spaceship-prompt" --depth=1
ln -s "$ZSH_CUSTOM/themes/spaceship-prompt/spaceship.zsh-theme" "$ZSH_CUSTOM/themes/spaceship.zsh-theme"
```

---

## 5️⃣ Set the theme in `.zshrc`

Open your `~/.zshrc` file and set:

```bash
ZSH_THEME="spaceship"
```

---

## 6️⃣ Install ZSH Autosuggestions Plugin

```bash
git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
```

---

## 7️⃣ Install ZSH Syntax Highlighting Plugin

```bash
git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting
```

---

## 8️⃣ Enable Plugins in `.zshrc`

Edit your `~/.zshrc` and set the plugins list like this:

```bash
plugins=(git zsh-autosuggestions zsh-syntax-highlighting)
```

---

## 9️⃣ Reload ZSH Configuration

```bash
source ~/.zshrc
```

---

## ✅ Done!

Your terminal now features:

-   ZSH shell
-   Spaceship theme for a sleek, informative prompt
-   Command autosuggestions
-   Syntax highlighting

Enjoy your improved terminal experience! 🎉
