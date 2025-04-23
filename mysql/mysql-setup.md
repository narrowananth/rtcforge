1. lsof -i TCP:3306 (or) lsof -i TCP:3306 | grep mysqld --> These command to fetch the current active mysql server in local machine
2. mysql -u root
   UPDATE mysql.user SET authentication_string=PASSWORD('new_password') WHERE User='root';
   FLUSH PRIVILEGES;
   This command to update the user password
3. Update the password --> ALTER USER 'root'@'localhost' IDENTIFIED BY 'MyNewPass';
