const AWS = require('aws-sdk');

const sharp = require('sharp');
const fs = require('fs');

AWS.config.update({ region: 'ap-south-1' });

const encrypted = {
    accessKeyId: process.env.accessKeyId,
    secretAccessKey: process.env.secretAccessKey,
    region: process.env.region
};

let decrypted = {};

exports.handler = async (event) => {

    try {

        let imageData = JSON.parse(event.body);

        //Obtain aws configs via kms decoder
        const awsConfigs = await kmsDecoder();

        let destPath = await downloadFile(imageData, awsConfigs);

        let obtainedWebpFile = await convertJpgToWebp(destPath, imageData);

        let uploadedData = await uploadFileToS3(obtainedWebpFile, awsConfigs);

        fs.unlink(destPath);
        fs.unlink(obtainedWebpFile);

        return "success"; //{"message": "success"}
    } catch (err) {

        return err;
    }
};

let kmsDecoder = () => {

    return new Promise((resolve, reject) => {

        const kms = new AWS.KMS();

        const decryptPromises = [
            kms.decrypt({ CiphertextBlob: new Buffer(encrypted.accessKeyId, 'base64') }).promise(),
            kms.decrypt({ CiphertextBlob: new Buffer(encrypted.secretAccessKey, 'base64') }).promise(),
            kms.decrypt({ CiphertextBlob: new Buffer(encrypted.region, 'base64') }).promise()
        ];

        Promise.all(decryptPromises).then((data) => {

            decrypted.accessKeyId = data[0].Plaintext.toString('ascii');
            decrypted.secretAccessKey = data[1].Plaintext.toString('ascii');
            decrypted.region = data[2].Plaintext.toString('ascii');

            resolve(decrypted);
        }).catch(err => {

            console.log("err is ");
            console.log(err);
            reject(err);
        });
    })
}

let downloadFile = (imageData, awsConfigs) => {

    return new Promise((resolve, reject) => {

        let s3 = new AWS.S3({
            accessKeyId: awsConfigs.accessKeyId,
            secretAccessKey: awsConfigs.secretAccessKey,
            region: awsConfigs.region
        });

        //The raw image object contains the bucket name and the unique key of the image that needs to be processed.
        //They key would ideally be named as "my-image.jpeg"
        let rawImage = imageData.rawImage;

        let fileExtension = rawImage.key.slice(rawImage.key.lastIndexOf('.'));

        fileExtension = (!fileExtension || fileExtension === '') ? '.jpeg' : fileExtension;

        const destPath = `/tmp/${imageData.fileName}${fileExtension}`;

        const params = {
            Bucket: `${rawImage.bucket}`,
            Key: `${rawImage.key}`
        }

        const s3Stream2 = s3.getObject(params).createReadStream();

        const fileStream = fs.createWriteStream(destPath);

        s3Stream2.on('error', (err) => {

            console.log(err);
            reject(err);
        });

        fileStream.on('error', (err) => {

            console.log(err);
            reject(err);
        });

        fileStream.on('close', () => {

            console.log("file streaming has been done ");

            resolve(destPath);
        });

        s3Stream2.pipe(fileStream);
    })
} //end downloadFile() function

let convertJpgToWebp = (path, data) => {

    return new Promise((resolve, reject) => {

        sharp(path)
            .resize(720)
            .toFile(`/tmp/${data.fileName}-converted.webp`, (err, info) => {

                if(err) {

                    reject(err);
                } else {

                    resolve(`/tmp/${data.fileName}-converted.webp`);
                }
            }); //end sharp function
    })
}

let uploadFileToS3 = (path, awsConfigs) => {
    return new Promise((resolve, reject) => {

        let s3 = new AWS.S3({
            accessKeyId: awsConfigs.accessKeyId,
            secretAccessKey: awsConfigs.secretAccessKey,
            region: awsConfigs.region
        });

        //Add your bucket name in the bucket name field
        let bodyBuffer = new Buffer(fs.readFileSync(path));
        let today = Date.now();
        let uploadFileData = {
            Bucket: 'your-bucket-name',
            Key: `${today}.webp`,
            ACL: 'public-read',
            StorageClass: 'REDUCED_REDUNDANCY',
            ContentType: 'binary/octet-stream',
            CacheControl: '0',
            Body: bodyBuffer
        }

        s3.upload(uploadFileData, (err, data) => {
            if (err) {
                console.log("err is ");
                console.log(err);
                reject(err);
            } else {
                let resultantData = {
                    baseUrl: baseUrl(data.Location),
                    path: data.Key
                }
                resolve(resultantData);
            }
        });
    })
} //end uploadFile() function

let baseUrl = (url) => {

    let tempurl = url.split('/');
    let baseUrl = tempurl[0] + '//' + tempurl[2];
    return baseUrl;
};
