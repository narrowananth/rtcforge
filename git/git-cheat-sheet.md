# Git Cheat Sheet for Terminal (Mac)

This is a complete and updated Git cheat sheet for working via Terminal on macOS. It includes configuration, core commands, examples, and explanations.

---

## 1. Git Configuration

### Set Global Username and Email

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

### Check Global Config

```bash
git config --global user.name
git config --global user.email
```

### Local (Repo-Specific) Config

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

### Remove or Replace Global Config

```bash
# Remove
git config --global --unset-all user.name
git config --global --unset-all user.email

# Replace
git config --global --replace-all user.name "New Name"
git config --global --replace-all user.email "new@example.com"
```

---

## 2. Git Initialization & Cloning

### Initialize a Git Repo

```bash
git init
```

### Clone a Repository

```bash
git clone <repository_url>
```

---

## 3. Staging & Committing

### Add Files to Staging

```bash
git add <file>
# Add all
git add .
```

### Commit Changes

```bash
git commit -m "Your commit message"
```

---

## 4. Viewing Status & Logs

### Check Status

```bash
git status
```

### View Commit Log

```bash
git log
# Compact one-line log
git log --oneline
# Graph view
git log --graph --oneline --all
```

---

## 5. Branching

### Create a New Branch

```bash
git branch <branch_name>
```

### Switch Branch

```bash
git checkout <branch_name>
```

### Create and Switch in One Step

```bash
git checkout -b <branch_name>
```

### List All Branches

```bash
git branch
```

### Delete a Branch

```bash
git branch -d <branch_name>
```

---

## 6. Merging & Rebase

### 🔀 Merge a Branch into Current

**Merge** combines the history of two branches. It creates a new "merge commit" that joins two branches together.

#### 📌 Syntax

```bash
git merge <branch_name>
```

#### ✅ Use Case

You're on the `main` branch and want to merge the work from a feature branch called `feature/login-page`.

#### 🔧 Example

```bash
git checkout main
git merge feature/login-page
```

> This merges `feature/login-page` into `main`. If there are no conflicts, Git will automatically create a **merge commit**.

#### 📌 Pros

-   Keeps the complete history of changes from both branches.
-   Great for team environments where tracking every merge is important.

#### 🧱 Visual

```
       A---B---C feature/login-page
      /
D---E---F---G main (after merge)
```

---

### 🎯 Rebase Instead of Merge

**Rebase** transfers the changes from one branch onto another base tip, rewriting history for a cleaner linear progression.

#### 📌 Syntax

```bash
git rebase <branch_name>
```

#### ✅ Use Case

You're on `feature/login-page` and want to rebase your changes on top of the latest `main` to make your history linear and clean.

#### 🔧 Example

```bash
git checkout feature/login-page
git rebase main
```

> This replays the commits from `feature/login-page` onto the latest `main`, rewriting history to make it look like all your changes were based on the most recent commit in `main`.

#### 📌 Pros

-   Clean, linear history.
-   Easier to navigate with `git log` or `git bisect`.

#### ⚠️ Note

Avoid rebasing **shared branches** that others are working on—this can cause confusion and conflicts in collaborative environments.

#### 🧱 Visual

Before:

```
       A---B---C feature/login-page
      /
D---E---F main
```

After:

```
               A'--B'--C' feature/login-page (rebased)
              /
D---E---F main
```

> A', B', C' are the same changes as A, B, C but rewritten as new commits.

---

## 7. Remote Repositories

### Add Remote Repo

```bash
git remote add origin <repo_url>
```

### View Remotes

```bash
git remote -v
```

### Push Code

```bash
git push origin <branch_name>

# First time push
git push -u origin <branch_name>
```

### Pull Code

```bash
git pull origin <branch_name>
```

---

## 8. Stash

### Save Uncommitted Changes

```bash
git stash
```

### List Stashes

```bash
git stash list
```

### Apply Stash

```bash
git stash apply
```

---

## 9. Tags

### Create Tag

```bash
git tag <tag_name>
```

### Push Tags

```bash
git push origin <tag_name>
# Push all tags
git push origin --tags
```

---

## 10. Clean & Reset

### Remove Untracked Files

```bash
git clean -fd
```

### Discard Changes

```bash
git restore <file>
# All changes
git restore .
```

### Hard Reset to Previous Commit

```bash
git reset --hard HEAD~1 (N number of commit to go back)

git reset --soft HEAD~1 (N number of commit to go back)
```

---

## 11. Miscellaneous

### Check Config File Path

```bash
git config --list --show-origin
```

### Open Global Git Config

```bash
nano ~/.gitconfig
```

### Check Current Branch

```bash
git branch --show-current
```

---

This cheat sheet covers most daily-use Git commands with real examples and explanations. For advanced workflows (hooks, submodules, CI/CD integration), consider extending it further.
