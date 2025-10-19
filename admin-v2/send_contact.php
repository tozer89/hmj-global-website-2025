<?php
if ($_SERVER['REQUEST_METHOD'] == 'POST') {
  $name = strip_tags($_POST['name']);
  $email = strip_tags($_POST['email']);
  $message = strip_tags($_POST['message']);

  $to = "info@HMJ-Global.com";
  $subject = "New Contact Form Submission from $name";
  $body = "Name: $name\nEmail: $email\nMessage:\n$message";
  $headers = "From: $email";

  if (mail($to, $subject, $body, $headers)) {
    echo "Thank you! Your message has been sent.";
  } else {
    echo "Sorry, something went wrong.";
  }
} else {
  echo "Invalid request.";
}
?>
