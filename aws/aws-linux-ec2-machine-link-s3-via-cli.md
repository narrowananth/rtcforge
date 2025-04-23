# To config our AWS linux EC2 machine to S3 bucket through terminal command:

1. Setup our AWS linux EC2 machine

    - terminal command : aws configure
      AWS Access Key ID [None]: AKIAR7BXSEEES7OWVEFO // give your IAM user key
      AWS Secret Access Key [None]: eQ5q6kx0vipH4jp1myhTsTsm/8gMyALHgmF92Iyw // give your IAM user secret
      Default region name [None]: // Optional
      Default output format [None]: // Optional

2. upload EC2 machine folder file to S3 bucket

    - Syntax : aws s3 cp <source_file_path> s3://<bucket_name>/<destination_key>
    - Example : aws s3 cp ~/example.txt s3://my-bucket/folder/example.txt

    Here folder is Optinal
