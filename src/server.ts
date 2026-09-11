import app from './app';

const PORT = process.env.PORT || 5002;

app.listen(PORT, () => {
  console.log(`perfxcel-api running on port ${PORT}`);
});
