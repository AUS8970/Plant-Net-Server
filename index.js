require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const morgan = require('morgan')

const port = process.env.PORT || 5000
const app = express()
// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())
app.use(morgan('dev'))

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.yn4cz.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

async function run() {
  try {
    const db = client.db('plantNet')
    const usersCollection = db.collection('users');
    const plantsCollection = db.collection('plants');
    const ordersCollection = db.collection('orders');

    // save or update
    app.post('/users/:email', async(req, res) => {
      const email = req.params.email;
      const query = { email }
      const user = req.body
      // cheak if user exists in db
      const isExist = await usersCollection.findOne(query)
      if(isExist) {
        return res.send(isExist)
      }
      const result = await usersCollection.insertOne({
        ...user,
        role: 'customer',
        timestamp: Date.now()
      });
      res.send(result)
    });
    
    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    });

    // get all plants from db
    app.get('/plants', async(req, res) => {
      const result = await plantsCollection.find().limit(20).toArray();
      res.send(result);
    });
    
    // get a plant from db by id
    app.get('/plant/:id', async(req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await plantsCollection.findOne(query);
      res.send(result);
    });

    // save a plant data in db
    app.post('/plants', verifyToken, async(req, res) => {
      const plant = req.body;
      const result = await plantsCollection.insertOne(plant);
      res.send(result);
    });

    // manage plant quantity
    app.patch('/palnt/quantity/:id', verifyToken, async(req, res) => {
      const id = req.params.id;
      const { quantityToUpdate, status } = req.body;
      const filter = { _id: new ObjectId(id) };
      let updateDoc = {
        $inc: { quantity: -quantityToUpdate },
      }
      const result = await plantsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // get all customer orders from db
    app.get('/customer-orders/:email', verifyToken, async(req, res) => {
      const email = req.params.email;
      const result = await ordersCollection
      // aggregate pipeline
        .aggregate([
          // match specific customer email
          { $match : { 'customer.email': email}},
          // convert plantId to ObjectId
          { $addFields: { plantId: { $toObjectId: '$plantId' }}},
          // go to a different collection and get plant data
          { $lookup: { 
            // collection name
            from: 'plants',
            // local field from orders collection
            localField: 'plantId',
            // foreign field from plants collection
            foreignField: '_id',
            // as field name in output
            as: 'plants'
          }},
          // delete plants array
          { $unwind: '$plants' },
          // add plant name, image and category to output
          { $addFields: { name: '$plants.name', image: '$plants.image', category: '$plants.category' }},
          // remove plants field from output
          { $project: { plants: 0 }}
        ])
        .toArray();
      res.send(result);
    });

    // save order info data in db
    app.post('/order', verifyToken, async(req, res) => {
      const orderInfo = req.body;
      const result = await ordersCollection.insertOne(orderInfo);
      res.send(result);
    });

    // delete a customer order from db
    app.delete('/order/:id', verifyToken, async(req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const order = await ordersCollection.findOne(query);
      if (order.status === 'delivered') return res.status(409).send({ message: 'This order is already delivered' });
      const result = await ordersCollection.deleteOne(query);
      res.send(result);
    });

    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log('Pinged your deployment. You successfully connected to MongoDB!')
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from plantNet Server..')
})

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`)
})
