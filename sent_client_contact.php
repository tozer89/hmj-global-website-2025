<?php
if ($_SERVER["REQUEST_METHOD"] == "POST") {
  // Sanitize form fields
  $name = strip_tags(trim($_POST["name"]));
  $company = strip_tags(trim($_POST["company"]));
  $email = filter_var(trim($_POST["email"]), FILTER_SANITIZE_EMAIL);
  $phone = strip_tags(trim($_POST["phone"]));
  $subject = strip_tags(trim($_POST["subject"]));
  $message = trim($_POST["message"]);

  // Validate required fields
  if ( empty($name) || empty($company) || empty($email) || empty($phone) || empty($subject) || !filter_var($email, FILTER_VALIDATE_EMAIL) ) {
    echo "Please complete all required fields and use a valid email address.";
    exit;
  }

  // Email setup
  $recipient = "info@HMJ-Global.com";
  $email_subject = "New Client Vacancy Submission: $subject";
  $email_body = "You have received a new vacancy submission from a client:\n\n"
              . "Name: $name\n"
              . "Company: $company\n"
              . "Email: $email\n"
              . "Phone: $phone\n"
              . "Role Title: $subject\n"
              . "Role Details:\n$message\n";

  $headers = "From: $name <$email>";

  // Handle attachment if provided
  if (isset($_FILES['cv']) && $_FILES['cv']['error'] == UPLOAD_ERR_OK) {
    $file_tmp = $_FILES['cv']['tmp_name'];
    $file_name = $_FILES['cv']['name'];
    $file_size = $_FILES['cv']['size'];
    $file_type = $_FILES['cv']['type'];
    $handle = fopen($file_tmp, "rb");
    $content = fread($handle, $file_size);
    fclose($handle);
    $encoded_content = chunk_split(base64_encode($content));

    $boundary = md5("sanctum");

    $headers = "MIME-Version: 1.0\r\n";
    $headers .= "From: $name <$email>\r\n";
    $headers .= "Content-Type: multipart/mixed; boundary = $boundary\r\n\r\n";

    $body = "--$boundary\r\n";
    $body .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $body .= "Content-Transfer-Encoding: base64\r\n\r\n";
    $body .= chunk_split(base64_encode($email_body));

    $body .= "--$boundary\r\n";
    $body .= "Content-Type: $file_type; name=\"$file_name\"\r\n";
    $body .= "Content-Disposition: attachment; filename=\"$file_name\"\r\n";
    $body .= "Content-Transfer-Encoding: base64\r\n";
    $body .= "X-Attachment-Id: " . rand(1000, 99999) . "\r\n\r\n";
    $body .= $encoded_content;

    $sentMail = mail($recipient, $email_subject, $body, $headers);

  } else {
    // Send plain email without attachment
    $sentMail = mail($recipient, $email_subject, $email_body, $headers);
  }

  if ($sentMail) {
    echo "Thank you! Your vacancy has been submitted.";
  } else {
    echo "Oops! Something went wrong, and we couldn't send your message.";
  }

} else {
  echo "Please submit the form first.";
}
?>
