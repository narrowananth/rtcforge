# connect the Amazon Linux EC2 instance to local machine & also clone the git to EC2 instance

1. Connect to your Amazon Linux EC2 instance:

    - Open a terminal on your local machine.
    - Use SSH to connect to your EC2 instance. Replace `<your-instance-ip>` with the IP address or hostname of your EC2 instance.

    `ssh -i <path-to-your-private-key> ec2-user@<your-instance-ip>`

2. Install Git (if it's not already installed):

    - Update the package repository:

    `sudo yum update -y`

    - Install Git:

    `sudo yum install git -y`

3. Clone the repository:

    - Change to the directory where you want to clone the repository.

    `cd /path/to/your/local/directory`

    - Clone the repository using the Git URL. Replace `<repository-url>` with the actual URL of your repository.

    `git clone <repository-url>`

# To install Visual Studio Code (VS Code) on an Amazon Linux EC2 instance through the command line, you can follow these steps:

1. Connect to your Amazon Linux EC2 instance:

    - Open a terminal on your local machine.
    - Use SSH to connect to your EC2 instance. Replace `<your-instance-ip>` with the IP address or hostname of your EC2 instance.

    `ssh -i <path-to-your-private-key> ec2-user@<your-instance-ip>`

2. Update the package repository and install required dependencies:

    `sudo yum update -y`
    `sudo yum install -y epel-release`
    `sudo yum install -y curl libXss libX11-devel libsecret-devel gtk3-devel`

3. Download the VS Code package:

    `curl -o vscode.rpm -L https://go.microsoft.com/fwlink/?LinkID=760867`

4. Install the package:

    `sudo yum install -y ./vscode.rpm`

5. Start VS Code:

    `code`

Once the last command is executed, VS Code will be launched on your Amazon Linux EC2 instance, and you can start using it.
