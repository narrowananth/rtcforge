# code sample - 1

const aws = require('aws-sdk');
const fs = require('fs');

// Configure the AWS SDK with your access credentials
aws.config.update({
accessKeyId: 'YOUR_ACCESS_KEY',
secretAccessKey: 'YOUR_SECRET_ACCESS_KEY',
region: 'YOUR_AWS_REGION'
});

// Create a new instance of the S3 service
const s3 = new aws.S3();

// Define the parameters for the file upload
const bucketName = 'YOUR_BUCKET_NAME';
const fileName = 'example.jpg';
const filePath = '/path/to/example.jpg';

// Read the file data
const fileContent = fs.readFileSync(filePath);

// Set up the S3 upload parameters
const params = {
Bucket: bucketName,
Key: fileName,
Body: fileContent
};

// Upload the file to S3
s3.upload(params, (err, data) => {
if (err) {
console.error(err);
} else {
console.log(`File uploaded successfully. File URL: ${data.Location}`);
}
});

# code sample - 2

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Readable } = require('stream');
const fs = require('fs');

// Configure the AWS SDK with your access credentials
const s3Client = new S3Client({
region: 'YOUR_AWS_REGION',
credentials: {
accessKeyId: 'YOUR_ACCESS_KEY',
secretAccessKey: 'YOUR_SECRET_ACCESS_KEY'
}
});

// Define the parameters for the file upload
const bucketName = 'YOUR_BUCKET_NAME';
const fileName = 'example.jpg';
const filePath = '/path/to/example.jpg';

// Read the file data as a stream
const fileStream = fs.createReadStream(filePath);

// Set up the S3 upload parameters
const params = {
Bucket: bucketName,
Key: fileName,
Body: fileStream
};

// Create a helper function to convert a Readable stream to a buffer
const streamToBuffer = (stream) => {
return new Promise((resolve, reject) => {
const chunks = [];
stream.on('data', (chunk) => chunks.push(chunk));
stream.on('error', (error) => reject(error));
stream.on('end', () => resolve(Buffer.concat(chunks)));
});
};

// Upload the file to S3
(async () => {
try {
// Convert the stream to a buffer
const fileBuffer = await streamToBuffer(fileStream);
params.Body = fileBuffer;

    // Upload the file
    const command = new PutObjectCommand(params);
    const response = await s3Client.send(command);

    console.log(`File uploaded successfully. File URL: ${response.Location}`);

} catch (error) {
console.error(error);
}
})();
