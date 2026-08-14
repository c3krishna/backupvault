
const { exec } = require("child_process");

exec(
  "aws s3 ls s3://worktual-db-backup/ --region eu-west-2",
  (error, stdout, stderr) => {
    console.log("stdout:", stdout);
    console.log("stderr:", stderr);

    if (error) {
      console.log("Error Code:", error.code);
      console.log("Error:", error.message);
    }
  }
);
