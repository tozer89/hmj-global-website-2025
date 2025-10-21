<?php
if ($_SERVER['REQUEST_METHOD'] == 'POST') {
  $name = strip_tags($_POST['name']);
  $email = strip_tags($_POST['email']);

  $to = "info@HMJ-Global.com";
  $subject = "New CV Submission from $name";

  $message = "Name: $name\nEmail: $email";

  $headers = "From: $email";

  if (isset($_FILES['cv']) && $_FILES['cv']['error'] == UPLOAD_ERR_OK) {
    $uploadfile = tempnam(sys_get_temp_dir(), sha1($_FILES['cv']['name']));
    if (move_uploaded_file($_FILES['cv']['tmp_name'], $uploadfile)) {
      mail($to, $subject, $message, $headers);
      echo "Thank you! Your CV has been sent.";
    } else {
      echo "Upload failed.";
    }
  } else {
    echo "Please attach a valid file.";
  }
} else {
  echo "Invalid request.";
}
?>
