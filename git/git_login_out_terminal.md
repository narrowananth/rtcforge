# Log in & out of Git via Terminal (Mac)

1. Log in, adding Git username and email

Open Terminal

-  Set your Git user name, Confirm that you have set a Git username correctly

$ git config --global user.name "your name"

-  Set an email address in Git, Use the email you use to sign into Github

$ git config --global user.email "email@email.com"

$ git config --global user.name
$ git config --global user.email

2. Signing in for a single repository

- Use the code above but remove

--global

3. Removing/Changing Git username or email

- Removing Global

$ git config --global --unset-all user.name
$ git config --global --unset-all user.email

- Changing Global

$ git config --global --replace-all user.name "Your New Name"
$ git config --global --replace-all user.email "Your new email"
