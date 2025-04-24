# 🧠 Zsh Git Short Command Cheat Sheet

> Common aliases available through `oh-my-zsh` Git plugin (`plugins=(git)` in `.zshrc`)

---

## 🔍 Status & Logs

```bash
gst      # git status
glog     # git log --oneline --decorate --graph
gss      # git status -s
```

## 📁 Add & Restore

```bash
gaa      # git add --all
gapa     # git add --patch
gunstage # git reset HEAD <file>
grestore # git restore <file>
```

## 📤 Commit & Push

```bash
gcm      # git commit -m
gcam     # git commit -a -m
gca      # git commit -a
gp       # git push
gpoat    # git push origin --all && git push origin --tags
```

## 📥 Pull & Fetch

```bash
gpl      # git pull
gfa      # git fetch --all
gcl      # git clone <repo>
```

## 🌿 Branching

```bash
gco      # git checkout
gcb      # git checkout -b
gbr      # git branch
gbd      # git branch -d
gbD      # git branch -D
gmerge   # git merge <branch>
grebase  # git rebase <branch>
```

## 🧹 Clean & Reset

```bash
gclean   # git clean -fd
gres     # git reset --hard
greset   # git reset
```

## 🗂️ Stash

```bash
gstsh    # git stash
gstshp   # git stash pop
gstshl   # git stash list
gstshd   # git stash drop
```

## 🔧 Config & Utils

```bash
gconf    # git config -l
glg      # git log --graph --oneline --decorate --all
gcount   # git shortlog -sn
gignored # git ls-files --others -i --exclude-standard
```

---

💡 Tip: You can customize or extend these by editing your `.zshrc` or using `git config --global alias.<shortcut>`.
