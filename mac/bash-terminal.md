# Bash Terminal Setup (Spaceship-Like Prompt via Starship)

This guide walks through how to configure your **Bash terminal on macOS** to look and behave similarly to a customized Zsh terminal using **Starship prompt**, providing Git, Node.js, Deno, Docker, and directory context.

---

## 1. Install Homebrew (if not installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

---

## 2. Install Starship Prompt

```bash
brew install starship
```

---

## 3. Add Starship to Bash Config

Append this to your `~/.bash_profile` or `~/.bashrc` file:

```bash
eval "$(starship init bash)"
```

Reload the terminal or run:

```bash
source ~/.bash_profile  # or source ~/.bashrc
```

---

## 4. Create Starship Configuration File

Create the config folder (if not already):

```bash
mkdir -p ~/.config
```

Then edit the file:

```bash
nano ~/.config/starship.toml
```

Paste the following configuration:

```toml
# ~/.config/starship.toml

format = """
$directory$git_branch$nodejs$deno$docker_context
$character
"""

[directory]
style = "blue"
truncation_length = 3
truncation_symbol = "…/"

[git_branch]
symbol = " "
style = "purple"

[nodejs]
symbol = "⬢ "
style = "green"

[deno]
symbol = "�� "
style = "cyan"

[docker_context]
symbol = "🐳 "
style = "blue"
```

Save the file with `Ctrl + O` → Enter → `Ctrl + X`.

---

## 5. Verify the Prompt

Restart your terminal or run:

```bash
exec bash
```

You should now see a prompt like this:

```
CONNXT/backend on  main [$!?] via ⬢ v22.14.0 via �� v2.2.11 on 🐳 v27.5.1 (orbstack)
➔
```

---

## 6. Optional: Set Bash as Default Shell

If your default shell is Zsh and you want to switch back to Bash:

```bash
chsh -s /bin/bash
```

Logout and log back in for changes to take effect.

---

> ✅ You're now using a modern, minimal, spaceship-like Bash prompt with full development context!
